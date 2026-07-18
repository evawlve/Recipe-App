/**
 * serving-provenance.ts — audit of AI-estimated serving sizes in the food DB.
 *
 * Quantifies where AI-estimated servings exist even though genuine (declared)
 * servings were available, or where the estimates are implausible. Motivating
 * bug: "ghost vegan protein" got an AI-estimated 45g scoop while sibling
 * Ghost-branded products carry declared 35g scoops.
 *
 * Talks straight to Postgres via @prisma/client raw SQL (no repo code paths).
 * DATABASE_URL is read from .env; a connection_limit=1 override pins every
 * query to ONE connection so session temp tables survive across calls.
 * All heavy work is done server-side against bounded temp tables (OffServing
 * is ~760k rows, OffFood ~4.2M — no unbounded cross joins, listings LIMITed).
 *
 * Sections:
 *   1. Global counts — OffServing by isAiEstimated × source; AiGenerated* counts.
 *   2. Per-unit sanity — genuine vs AI grams distributions per unit keyword
 *      (scoop/slice/piece/bar/cup/tbsp/tsp/bottle/can/packet/egg) + AI rows
 *      deviating >40% from the genuine median (≤50 rows per unit).
 *   3. Ghost-case generalized — AI estimates that were AVOIDABLE because a
 *      same-brand food (or, for brandless/AiGenerated foods, a branded food
 *      sharing ≥2 significant name tokens) has a genuine serving for the same
 *      unit. Token variant runs on a bounded sample (≤500 AI rows).
 *   4. Summary — totals, top-10 worst offenders, one-line verdict.
 *
 * Run (from repo root):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/eval/serving-provenance.ts
 *
 * Results are written to scripts/eval/results/provenance-<timestamp>.json.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Env / client setup (dependency-light: parse .env ourselves, no dotenv needed)
// ---------------------------------------------------------------------------

const repoRoot = path.join(__dirname, '..', '..');
function loadEnvVar(name: string): string | undefined {
    if (process.env[name]) return process.env[name];
    for (const file of ['.env.local', '.env.development', '.env']) {
        const p = path.join(repoRoot, file);
        if (!fs.existsSync(p)) continue;
        for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
            const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"\\n]+)"?\\s*$`));
            if (m) return m[1];
        }
    }
    return undefined;
}

const rawUrl = loadEnvVar('DATABASE_URL');
if (!rawUrl) { console.error('DATABASE_URL not found in env or .env files'); process.exit(2); }
// Pin to a single connection so TEMP tables persist across queries.
const dbUrl = rawUrl + (rawUrl.includes('?') ? '&' : '?') + 'connection_limit=1';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function q<T = any>(sql: string): Promise<T[]> {
    return prisma.$queryRawUnsafe(sql) as Promise<T[]>;
}
async function exec(sql: string): Promise<void> {
    await prisma.$executeRawUnsafe(sql);
}

// ---------------------------------------------------------------------------
// Unit keyword taxonomy (Postgres \m...\M = word boundaries, case-insensitive)
// ---------------------------------------------------------------------------

const UNITS: { unit: string; regex: string }[] = [
    { unit: 'scoop', regex: '\\mscoops?\\M' },
    { unit: 'slice', regex: '\\mslices?\\M' },
    { unit: 'piece', regex: '\\mpieces?\\M' },
    { unit: 'bar', regex: '\\mbars?\\M' },
    { unit: 'cup', regex: '\\mcups?\\M' },
    { unit: 'tbsp', regex: '\\m(tbsp|tablespoons?)\\M' },
    { unit: 'tsp', regex: '\\m(tsp|teaspoons?)\\M' },
    { unit: 'bottle', regex: '\\mbottles?\\M' },
    { unit: 'can', regex: '\\mcans?\\M' },
    { unit: 'packet', regex: '\\m(packets?|sachets?)\\M' },
    { unit: 'egg', regex: '\\meggs?\\M' },
];

function unitCaseSql(col: string): string {
    return 'CASE ' + UNITS.map(u => `WHEN ${col} ~* '${u.regex}' THEN '${u.unit}'`).join(' ') + ' ELSE NULL END';
}

const STOPWORDS = [
    'with', 'from', 'pack', 'flavor', 'flavour', 'flavored', 'flavoured', 'original',
    'natural', 'organic', 'style', 'food', 'foods', 'free', 'light', 'extra', 'classic',
    'premium', 'fresh', 'brand', 'mixed', 'blend', 'sugar', 'gluten',
];

function pct(n: number, d: number): string {
    return d === 0 ? 'n/a' : ((100 * n) / d).toFixed(2) + '%';
}
function dev(grams: number, median: number): number {
    if (!median || !grams) return 0;
    return Math.abs(grams - median) / median;
}

const report: any = { ranAt: new Date().toISOString(), db: dbUrl.replace(/:[^:@/]+@/, ':****@') };
const section = (title: string) => console.log(`\n======== ${title} ========`);

async function main() {
    const t0 = Date.now();

    // =======================================================================
    // Section 1 — Global counts
    // =======================================================================
    section('1. GLOBAL COUNTS');
    const bySrc = await q<{ isAiEstimated: boolean; source: string; n: number }>(
        `SELECT "isAiEstimated", source, count(*)::int AS n
         FROM "OffServing" GROUP BY 1, 2 ORDER BY "isAiEstimated", n DESC`);
    const totals = await q<any>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE "isAiEstimated")::int AS ai,
                count(DISTINCT barcode)::int AS barcodes,
                count(DISTINCT barcode) FILTER (WHERE "isAiEstimated")::int AS ai_barcodes
         FROM "OffServing"`);
    const aiGen = await q<any>(
        `SELECT (SELECT count(*)::int FROM "AiGeneratedFood") AS foods,
                (SELECT count(*)::int FROM "AiGeneratedServing") AS servings`);

    const t = totals[0];
    console.log(`OffServing rows: ${t.total} across ${t.barcodes} barcodes`);
    console.log(`  AI-estimated: ${t.ai} rows (${pct(t.ai, t.total)}) on ${t.ai_barcodes} distinct barcodes`);
    for (const r of bySrc) {
        console.log(`  ${r.isAiEstimated ? 'AI     ' : 'genuine'} source=${(r.source ?? 'null').padEnd(16)} ${r.n}`);
    }
    console.log(`AiGeneratedFood: ${aiGen[0].foods} foods, ${aiGen[0].servings} servings (all AI by construction)`);
    report.global = { offServing: t, bySource: bySrc, aiGenerated: aiGen[0] };

    // =======================================================================
    // Temp tables: unit-tag every serving row once (single seq scan), index it.
    // =======================================================================
    await exec(`CREATE TEMP TABLE serv_tagged AS
        SELECT s.id, s.barcode, s.description, s.grams, s."isAiEstimated", s.source, s.confidence,
               ${unitCaseSql('s.description')} AS unit
        FROM "OffServing" s
        WHERE s.grams > 0`);
    await exec(`DELETE FROM serv_tagged WHERE unit IS NULL`);
    await exec(`CREATE INDEX st_unit ON serv_tagged (unit)`);
    await exec(`CREATE INDEX st_bar ON serv_tagged (barcode)`);

    // =======================================================================
    // Section 2 — Per-unit sanity: genuine vs AI grams distributions
    // =======================================================================
    section('2. PER-UNIT SANITY (genuine vs AI grams)');
    const dist = await q<any>(
        `SELECT unit, "isAiEstimated", count(*)::int AS n,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY grams) AS median,
                percentile_cont(0.1) WITHIN GROUP (ORDER BY grams) AS p10,
                percentile_cont(0.9) WITHIN GROUP (ORDER BY grams) AS p90
         FROM serv_tagged GROUP BY 1, 2 ORDER BY 1, 2`);

    const genuineMedian: Record<string, number> = {};
    const unitStats: any = {};
    for (const u of UNITS) {
        const g = dist.find((d: any) => d.unit === u.unit && !d.isAiEstimated);
        const a = dist.find((d: any) => d.unit === u.unit && d.isAiEstimated);
        if (g) genuineMedian[u.unit] = g.median;
        unitStats[u.unit] = {
            genuine: g ? { n: g.n, median: g.median, p10: g.p10, p90: g.p90 } : null,
            ai: a ? { n: a.n, median: a.median, p10: a.p10, p90: a.p90 } : null,
        };
        const gs = g ? `genuine n=${String(g.n).padStart(6)} median=${g.median}g p10=${g.p10} p90=${g.p90}` : 'genuine: none';
        const as = a ? ` | AI n=${a.n} median=${a.median}g p10=${a.p10} p90=${a.p90}` : ' | AI: none';
        console.log(`  ${u.unit.padEnd(7)} ${gs}${as}`);
    }

    // AI rows deviating >40% from the genuine median for their unit (≤50/unit).
    const outliers: any[] = [];
    for (const u of UNITS) {
        const med = genuineMedian[u.unit];
        if (!med) continue;
        const rows = await q<any>(
            `SELECT a.id, a.barcode, f.name, f."brandName", a.description, a.grams, a.confidence, a.source
             FROM serv_tagged a JOIN "OffFood" f ON f.barcode = a.barcode
             WHERE a."isAiEstimated" AND a.unit = '${u.unit}'
               AND (a.grams < ${med} * 0.6 OR a.grams > ${med} * 1.4)
             ORDER BY abs(a.grams - ${med}) / ${med} DESC
             LIMIT 50`);
        for (const r of rows) outliers.push({ unit: u.unit, genuineMedian: med, deviation: +dev(r.grams, med).toFixed(2), ...r });
    }
    if (outliers.length) {
        console.log(`\n  AI rows deviating >40% from genuine unit median: ${outliers.length}`);
        for (const o of outliers.slice(0, 20)) {
            console.log(`    [${o.unit}] "${o.name}" (${o.brandName ?? 'no brand'}) "${o.description}" = ${o.grams}g vs median ${o.genuineMedian}g (${(o.deviation * 100).toFixed(0)}% off, conf=${o.confidence ?? '?'})`);
        }
    } else {
        console.log('\n  No AI rows deviate >40% from their unit\'s genuine median.');
    }
    report.perUnit = { distributions: unitStats, outliersOver40pct: outliers };

    // =======================================================================
    // Section 3a — Avoidable estimates: same-brand genuine serving exists
    // =======================================================================
    section('3a. AVOIDABLE — same brand has genuine serving for same unit');
    await exec(`CREATE TEMP TABLE brand_gen AS
        SELECT f."brandName" AS brand, g.unit,
               count(*)::int AS n,
               count(DISTINCT g.barcode)::int AS n_barcodes,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY g.grams) AS median_grams
        FROM serv_tagged g JOIN "OffFood" f ON f.barcode = g.barcode
        WHERE NOT g."isAiEstimated" AND f."brandName" IS NOT NULL
        GROUP BY 1, 2`);
    await exec(`CREATE INDEX bg_idx ON brand_gen (brand, unit)`);

    const avoidableBrand = await q<any>(
        `SELECT a.id, a.barcode, f.name, f."brandName", a.description, a.grams, a.confidence, a.source,
                bg.n AS brand_genuine_n, bg.median_grams AS brand_genuine_median
         FROM serv_tagged a
         JOIN "OffFood" f ON f.barcode = a.barcode
         JOIN brand_gen bg ON bg.brand = f."brandName" AND bg.unit = a.unit
         WHERE a."isAiEstimated"
           AND EXISTS (SELECT 1 FROM serv_tagged g
                       WHERE NOT g."isAiEstimated" AND g.unit = a.unit AND g.barcode <> a.barcode
                         AND g.barcode IN (SELECT barcode FROM "OffFood" ff WHERE ff."brandName" = f."brandName"))
         ORDER BY abs(a.grams - bg.median_grams) / NULLIF(bg.median_grams, 0) DESC
         LIMIT 200`);
    for (const r of avoidableBrand) r.deviation = +dev(r.grams, r.brand_genuine_median).toFixed(2);

    console.log(`  AI-estimated servings with a same-brand genuine serving for the same unit: ${avoidableBrand.length}`);
    for (const r of avoidableBrand.slice(0, 20)) {
        console.log(`    "${r.name}" [${r.brandName}] "${r.description}" AI=${r.grams}g vs brand genuine median ${r.brand_genuine_median}g (n=${r.brand_genuine_n}, ${(r.deviation * 100).toFixed(0)}% off)`);
    }
    report.avoidableSameBrand = avoidableBrand;

    // =======================================================================
    // Section 3b — Avoidable (token variant): brandless AI rows + AiGenerated
    // foods sharing ≥2 significant name tokens with a branded food that has a
    // genuine serving for the same unit. Bounded sample (≤500 AI rows).
    // =======================================================================
    section('3b. AVOIDABLE — brandless/AiGenerated foods vs branded genuine (token match, sampled)');

    const stopList = STOPWORDS.map(s => `'${s}'`).join(',');

    // Sample: brandless OffServing AI rows + ALL AiGeneratedServing rows
    // (27 total today — trivially within the cap), unified shape.
    await exec(`CREATE TEMP TABLE ai_sample AS
        SELECT 'off:' || a.id::text AS aid, a.barcode AS ref, f.name, a.description, a.grams, a.unit, a.confidence
        FROM serv_tagged a JOIN "OffFood" f ON f.barcode = a.barcode
        WHERE a."isAiEstimated" AND f."brandName" IS NULL
        LIMIT 500`);
    await exec(`INSERT INTO ai_sample
        SELECT 'aigen:' || s.id AS aid, g."ingredientName" AS ref, g."displayName" AS name,
               s.label AS description, s.grams, ${unitCaseSql('s.label')} AS unit, s."aiConfidence" AS confidence
        FROM "AiGeneratedServing" s JOIN "AiGeneratedFood" g ON g.id = s."foodId"
        WHERE s.grams > 0
        LIMIT 500`);
    await exec(`DELETE FROM ai_sample WHERE unit IS NULL`);
    const sampleN = (await q<any>(`SELECT count(*)::int AS n FROM ai_sample`))[0].n;

    // Tokenize sample names (significant = len>=4, not a stopword, not numeric).
    await exec(`CREATE TEMP TABLE ai_tokens AS
        SELECT DISTINCT s.aid, s.unit, tok
        FROM ai_sample s, LATERAL regexp_split_to_table(lower(s.name), '[^a-z0-9]+') tok
        WHERE length(tok) >= 4 AND tok !~ '^[0-9]+$' AND tok NOT IN (${stopList})`);

    // Branded genuine servings whose food name contains any sampled token.
    await exec(`CREATE TEMP TABLE branded_tokens AS
        SELECT g.barcode, g.unit, g.grams, f.name, f."brandName", tok
        FROM serv_tagged g
        JOIN "OffFood" f ON f.barcode = g.barcode AND f."brandName" IS NOT NULL,
        LATERAL regexp_split_to_table(lower(f.name), '[^a-z0-9]+') tok
        WHERE NOT g."isAiEstimated"
          AND length(tok) >= 4 AND tok NOT IN (${stopList})
          AND tok IN (SELECT DISTINCT tok FROM ai_tokens)`);
    // Drop ultra-common tokens (join-explosion guard on a modest server).
    await exec(`DELETE FROM branded_tokens WHERE tok IN (
        SELECT tok FROM branded_tokens GROUP BY tok HAVING count(*) > 20000)`);

    const tokenMatches = await q<any>(
        `WITH pairs AS (
            SELECT t.aid, b.barcode, b.unit, count(DISTINCT t.tok)::int AS shared_tokens,
                   min(b.name) AS branded_name, min(b."brandName") AS branded_brand,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY b.grams) AS branded_grams
            FROM ai_tokens t
            JOIN branded_tokens b ON b.tok = t.tok AND b.unit = t.unit
            GROUP BY t.aid, b.barcode, b.unit
            HAVING count(DISTINCT t.tok) >= 2
         ), best AS (
            SELECT DISTINCT ON (aid) aid, barcode, unit, shared_tokens, branded_name, branded_brand, branded_grams,
                   count(*) OVER (PARTITION BY aid) AS n_branded_matches
            FROM pairs ORDER BY aid, shared_tokens DESC
         )
         SELECT s.aid, s.ref, s.name, s.description, s.grams, s.unit, s.confidence,
                b.shared_tokens, b.branded_name, b.branded_brand, b.branded_grams, b.n_branded_matches::int AS n_branded_matches
         FROM best b JOIN ai_sample s ON s.aid = b.aid
         ORDER BY abs(s.grams - b.branded_grams) / NULLIF(b.branded_grams, 0) DESC NULLS LAST
         LIMIT 200`);
    for (const r of tokenMatches) r.deviation = +dev(r.grams, r.branded_grams).toFixed(2);

    console.log(`  Sampled AI rows (brandless OffServing + AiGenerated, unit-matched): ${sampleN}`);
    console.log(`  ...with a branded genuine serving sharing >=2 name tokens for the same unit: ${tokenMatches.length}`);
    for (const r of tokenMatches.slice(0, 20)) {
        console.log(`    [${r.aid}] "${r.name}" "${r.description}" AI=${r.grams}g <-> "${r.branded_name}" [${r.branded_brand}] genuine ${r.branded_grams}g (${r.shared_tokens} shared tokens, ${r.n_branded_matches} branded matches, ${(r.deviation * 100).toFixed(0)}% off)`);
    }
    report.avoidableTokenVariant = { sampleSize: sampleN, matches: tokenMatches };

    // =======================================================================
    // Section 4 — Summary
    // =======================================================================
    section('4. SUMMARY');
    const worst = [
        ...outliers.map(o => ({ kind: 'unit-outlier', name: o.name, brand: o.brandName, desc: o.description, grams: o.grams, reference: o.genuineMedian, deviation: o.deviation })),
        ...avoidableBrand.map((r: any) => ({ kind: 'same-brand', name: r.name, brand: r.brandName, desc: r.description, grams: r.grams, reference: r.brand_genuine_median, deviation: r.deviation })),
        ...tokenMatches.map((r: any) => ({ kind: 'token-match', name: r.name, brand: null, desc: r.description, grams: r.grams, reference: r.branded_grams, deviation: r.deviation })),
    ].sort((a, b) => b.deviation - a.deviation).slice(0, 10);

    const totalAi = t.ai + aiGen[0].servings;
    const totalAvoidable = avoidableBrand.length + tokenMatches.length;
    const verdict =
        totalAi === 0 ? 'No AI-estimated servings in the DB — nothing to audit.' :
        totalAvoidable === 0 ? `AI estimates exist (${totalAi}) but none were avoidable via same-brand or token-matched genuine servings.` :
        `${totalAvoidable}/${totalAi} AI-estimated servings (${pct(totalAvoidable, totalAi)}) were AVOIDABLE — a genuine serving for the same unit existed on a same-brand or name-similar branded product.`;

    console.log(`  OffServing AI rows: ${t.ai} (${pct(t.ai, t.total)} of ${t.total}) | AiGeneratedServing rows: ${aiGen[0].servings}`);
    console.log(`  Unit-median outliers (>40% off): ${outliers.length}`);
    console.log(`  Avoidable via same brand: ${avoidableBrand.length}`);
    console.log(`  Avoidable via token match (sampled ${sampleN}): ${tokenMatches.length}`);
    console.log('  Top offenders:');
    for (const w of worst) {
        console.log(`    [${w.kind}] "${w.name}"${w.brand ? ` [${w.brand}]` : ''} "${w.desc}" ${w.grams}g vs ${w.reference}g reference (${(w.deviation * 100).toFixed(0)}% off)`);
    }
    console.log(`\n  VERDICT: ${verdict}`);
    report.summary = {
        offServingAiRows: t.ai, aiGeneratedServings: aiGen[0].servings,
        unitOutliers: outliers.length, avoidableSameBrand: avoidableBrand.length,
        avoidableTokenMatch: tokenMatches.length, tokenSampleSize: sampleN,
        top10Worst: worst, verdict,
    };

    // ---- Write results ----
    const outDir = path.join(__dirname, 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `provenance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? Number(v) : v), 2));
    console.log(`\nResults written to ${path.relative(process.cwd(), outPath)}`);
    console.log(`Total runtime: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    await prisma.$disconnect();
}

main().catch(async err => {
    console.error(err);
    await prisma.$disconnect().catch(() => {});
    process.exit(2);
});
