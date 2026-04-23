/**
 * ai-audit-validated-mappings.ts — AI-powered cache quality verification
 *
 * Uses Gemini Flash (via OpenRouter) to verify every ValidatedMapping entry,
 * checking BOTH semantic correctness (right food?) AND nutritional plausibility
 * (right macros?).
 *
 * For each entry it sends:
 *   - The original ingredient string
 *   - The resolved food name + brand
 *   - Macros per 100g: kcal, protein, carbs, fat (joined from FatSecretFoodCache / FdcFoodCache)
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/ai-audit-validated-mappings.ts
 *   npx ts-node ... --dry-run               # preview prompts without API calls
 *   npx ts-node ... --batch-size=30         # default 50
 *   npx ts-node ... --model=google/gemini-2.5-flash-preview
 *   npx ts-node ... --reset                 # ignore previous state, restart
 *   npx ts-node ... --usda-only             # only audit most recent 1590 (USDA-seeded)
 *
 * Cost: ~$0.01-0.03 for all 3,007 entries using Gemini 2.0 Flash free tier
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Config ───────────────────────────────────────────────────────────────────

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY ?? '';
const DEFAULT_MODEL       = 'google/gemini-2.0-flash-exp:free';

const STATE_FILE  = path.join(__dirname, '..', 'logs', 'ai-audit-state.json');
const REPORT_BASE = path.join(__dirname, '..', 'logs',
    `ai-mapping-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Macros {
    kcal:    number | null;
    protein: number | null;
    carbs:   number | null;
    fat:     number | null;
}

interface MappingRow {
    id:           string;
    rawIngredient: string;
    normalizedForm: string;
    foodId:       string;
    foodName:     string;
    brandName:    string | null;
    source:       string;
    aiConfidence: number | null;
    createdAt:    Date;
    macros:       Macros;          // enriched after JOIN
    macroMissing: boolean;         // true if we couldn't find the food in either cache
}

type Verdict = 'OK' | 'FLAG' | 'UNCERTAIN';

interface EntryVerdict {
    id:           string;
    rawIngredient: string;
    foodName:     string;
    brandName:    string | null;
    macros:       Macros;
    verdict:      Verdict;
    reason:       string;
}

// ─── Macro extraction helpers ────────────────────────────────────────────────

/**
 * FatSecret nutrientsPer100g is a JSON object with keys like:
 *   { calories: "52", protein: "0.26", carbohydrate: "13.81", fat: "0.17" }
 * (values are sometimes strings, sometimes numbers)
 */
function parseFatSecretMacros(nutrientsPer100g: unknown): Macros {
    if (!nutrientsPer100g || typeof nutrientsPer100g !== 'object') {
        return { kcal: null, protein: null, carbs: null, fat: null };
    }
    const n = nutrientsPer100g as Record<string, unknown>;
    const toNum = (v: unknown) => {
        const x = parseFloat(String(v ?? ''));
        return isNaN(x) ? null : x;
    };
    return {
        kcal:    toNum(n['calories']     ?? n['energy']       ?? n['kcal']),
        protein: toNum(n['protein']),
        carbs:   toNum(n['carbohydrate'] ?? n['carbs']        ?? n['carbohydrates']),
        fat:     toNum(n['fat']          ?? n['total_fat']    ?? n['totalFat']),
    };
}

/**
 * FDC nutrients JSON can use either:
 *   Numeric keys (standard FDC): { "1008": 52, "1003": 0.26, "1005": 13.81, "1004": 0.17 }
 *   Named keys (our USDA saturation script): { calories: 52, protein: 0.26, carbs: 13.81, fat: 0.17 }
 * Standard FDC nutrient IDs:
 *   1008 = Energy (kcal), 1003 = Protein (g), 1005 = Carbs (g), 1004 = Total fat (g)
 */
function parseFdcMacros(nutrients: unknown): Macros {
    if (!nutrients || typeof nutrients !== 'object') {
        return { kcal: null, protein: null, carbs: null, fat: null };
    }
    const n = nutrients as Record<string, unknown>;
    const toNum = (v: unknown) => {
        const x = parseFloat(String(v ?? ''));
        return isNaN(x) ? null : x;
    };
    return {
        kcal:    toNum(n['1008']     ?? n['calories'] ?? n['energy']),
        protein: toNum(n['1003']     ?? n['protein']),
        carbs:   toNum(n['1005']     ?? n['carbs']    ?? n['carbohydrate'] ?? n['carbohydrates']),
        fat:     toNum(n['1004']     ?? n['fat']       ?? n['totalFat']    ?? n['total_fat']),
    };
}

function formatMacros(m: Macros): string {
    const fmt = (v: number | null, unit: string) =>
        v != null ? `${Math.round(v)}${unit}` : '?';
    return `${fmt(m.kcal, 'kcal')} | P:${fmt(m.protein, 'g')} C:${fmt(m.carbs, 'g')} F:${fmt(m.fat, 'g')}`;
}

// ─── Macro enrichment ─────────────────────────────────────────────────────────

async function enrichWithMacros(rows: Omit<MappingRow, 'macros' | 'macroMissing'>[]): Promise<MappingRow[]> {
    // Route solely by foodId prefix — source field is unreliable
    // (FDC-backed entries have source='fatsecret' but foodId='fdc_XXXXXX')
    const fatSecretIds: string[] = [];
    const fdcIds: number[] = [];

    for (const row of rows) {
        if (row.foodId.startsWith('fdc_')) {
            const numId = parseInt(row.foodId.slice(4), 10);
            if (!isNaN(numId)) fdcIds.push(numId);
        } else {
            fatSecretIds.push(row.foodId);
        }
    }

    // Batch-fetch both caches
    const [fatSecretCaches, fdcCaches] = await Promise.all([
        fatSecretIds.length > 0
            ? prisma.fatSecretFoodCache.findMany({
                where: { id: { in: fatSecretIds } },
                select: { id: true, nutrientsPer100g: true },
            })
            : [],
        fdcIds.length > 0
            ? prisma.fdcFoodCache.findMany({
                where: { id: { in: fdcIds } },
                select: { id: true, nutrients: true },
            })
            : [],
    ]);

    const fsMap = new Map(fatSecretCaches.map(r => [r.id, r.nutrientsPer100g]));
    const fdcMap = new Map(fdcCaches.map(r => [r.id, r.nutrients]));

    return rows.map(row => {
        let macros: Macros = { kcal: null, protein: null, carbs: null, fat: null };
        let macroMissing = false;

        if (row.foodId.startsWith('fdc_')) {
            const numId = parseInt(row.foodId.slice(4), 10);
            const nutrients = fdcMap.get(numId);
            if (nutrients != null) {
                macros = parseFdcMacros(nutrients);
            } else {
                macroMissing = true;
            }
        } else {
            const nutrients = fsMap.get(row.foodId);
            if (nutrients != null) {
                macros = parseFatSecretMacros(nutrients);
            } else {
                macroMissing = true;
            }
        }

        return { ...row, macros, macroMissing };
    });
}

// ─── JSON Schema for structured response ──────────────────────────────────────

const RESPONSE_SCHEMA = {
    name: 'mapping_verdicts',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            verdicts: {
                type: 'array',
                items: {
                    type: 'object',
                    properties: {
                        index:   { type: 'integer' },
                        verdict: { type: 'string', enum: ['OK', 'FLAG', 'UNCERTAIN'] },
                        reason:  { type: 'string' },
                    },
                    required: ['index', 'verdict', 'reason'],
                    additionalProperties: false,
                },
            },
        },
        required: ['verdicts'],
        additionalProperties: false,
    },
} as const;

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert nutritionist auditing ingredient-to-food database mappings for a recipe nutrition tracker.

Each entry shows: the recipe ingredient → the matched food product → its macros per 100g.

You check TWO things:
1. SEMANTIC MATCH: Is the resolved food a reasonable match for the ingredient?
2. NUTRITIONAL PLAUSIBILITY: Are the macros reasonable for that food?

Verdict rules:

OK — Both the food name AND macros are correct.
  "chicken breast" → "Roasted Chicken Breast" | 165kcal P:31g C:0g F:3.6g  ✓
  "olive oil" → "Extra Virgin Olive Oil" | 884kcal P:0g C:0g F:100g  ✓
  "whole milk" → "Whole Milk" | 61kcal P:3.2g C:4.8g F:3.3g  ✓
  "black pepper" → "Black Pepper" | 251kcal P:10g C:64g F:3g  ✓

FLAG — Clearly wrong: wrong category, semantic inversion, or wildly wrong macros.
  Semantic: "drumstick leaves" → "Vanilla Ice Cream Drumstick"  ✗ (vegetable leaf → dessert)
  Semantic: "turmeric" → "Kombucha"  ✗ (spice → fermented drink)
  Macro:    "chicken breast" → "Chicken Breast" | 850kcal P:2g C:90g F:40g  ✗ (should be ~165kcal, high protein)
  Macro:    "olive oil" → "Olive Oil" | 10kcal P:0g C:0g F:0g  ✗ (pure oil should be ~880kcal)
  Macro:    "butter" → "Butter" | 5kcal P:0g C:0g F:0g  ✗ (should be ~717kcal)
  Macro:    "sugar" → "Sugar" | 300kcal P:30g C:30g F:30g  ✗ (sugar is 100% carbs, ~387kcal)

UNCERTAIN — Plausible but questionable (different fat%, wrong sub-type, macros slightly off).
  "lowfat milk" → "Skim Milk" | 35kcal P:3.4g C:5g F:0.1g  (different fat level, borderline)
  "ground beef" → "Beef Patty" | 250kcal P:17g C:0g F:20g  (cooked vs raw, plausible)
  No macros available — flag as UNCERTAIN with reason "no macro data"

For entries with no macro data (?), verdict on name match only; note "no macro data" in reason if UNCERTAIN.
Brand names are fine. Minor prep differences (raw/cooked/roasted) are OK.
Always return exactly one verdict per entry, preserving the 0-based index order.`;

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildUserPrompt(batch: MappingRow[]): string {
    const lines = batch.map((row, i) => {
        const food = row.brandName
            ? `"${row.foodName}" (${row.brandName})`
            : `"${row.foodName}"`;
        const macroStr = row.macroMissing
            ? 'macros: no data'
            : `macros/100g: ${formatMacros(row.macros)}`;
        const conf = row.aiConfidence != null
            ? ` [conf: ${(row.aiConfidence * 100).toFixed(0)}%]`
            : '';
        return `${i}. "${row.rawIngredient}" → ${food} | ${macroStr}${conf}`;
    });
    return `Audit these ${batch.length} ingredient→food mappings:\n\n${lines.join('\n')}`;
}

// ─── OpenRouter call ──────────────────────────────────────────────────────────

async function callGemini(batch: MappingRow[], model: string): Promise<EntryVerdict[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45_000);

    try {
        const resp = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'HTTP-Referer': 'https://recipe-app.local',
                'X-Title': 'Recipe App Mapping Audit',
            },
            body: JSON.stringify({
                model,
                response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user',   content: buildUserPrompt(batch) },
                ],
                temperature: 0,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!resp.ok) {
            const body = await resp.text();
            throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
        }

        const payload = await resp.json() as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = payload.choices?.[0]?.message?.content;
        if (!raw) throw new Error('Empty response from model');

        const parsed = JSON.parse(raw) as {
            verdicts: Array<{ index: number; verdict: string; reason: string }>;
        };

        return parsed.verdicts.map(v => ({
            id:           batch[v.index].id,
            rawIngredient: batch[v.index].rawIngredient,
            foodName:     batch[v.index].foodName,
            brandName:    batch[v.index].brandName,
            macros:       batch[v.index].macros,
            verdict:      v.verdict as Verdict,
            reason:       v.reason,
        }));
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args       = process.argv.slice(2);
    const isDryRun   = args.includes('--dry-run');
    const isReset    = args.includes('--reset');
    const usdaOnly   = args.includes('--usda-only');
    const batchSize  = Number(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] ?? '50');
    const model      = args.find(a => a.startsWith('--model='))?.split('=')[1] ?? DEFAULT_MODEL;
    const delayMs    = Number(args.find(a => a.startsWith('--delay-ms='))?.split('=')[1] ?? '1200');

    if (!OPENROUTER_API_KEY && !isDryRun) {
        console.error('❌ OPENROUTER_API_KEY not set in .env');
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(REPORT_BASE), { recursive: true });

    console.log(`🤖 AI Mapping Audit (name + macros) — model: ${model}`);
    console.log(`   batch-size=${batchSize}  delay-ms=${delayMs}${isDryRun ? '  [DRY RUN]' : ''}`);
    console.log('');

    // ── Load state ────────────────────────────────────────────────────────────
    type State = { processedBatches: number[]; flagged: EntryVerdict[]; uncertain: EntryVerdict[] };
    let state: State = { processedBatches: [], flagged: [], uncertain: [] };

    if (!isReset && fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        console.log(`📂 Resuming — ${state.processedBatches.length} batches done`);
        console.log(`   Flagged: ${state.flagged.length}  Uncertain: ${state.uncertain.length}`);
    }

    const doneSet = new Set(state.processedBatches);
    const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');

    // ── Load mappings ────────────────────────────────────────────────────────
    console.log('📦 Loading ValidatedMapping entries...');
    const rawRows = await prisma.validatedMapping.findMany({
        select: {
            id: true, rawIngredient: true, normalizedForm: true,
            foodId: true, foodName: true, brandName: true,
            source: true, aiConfidence: true, createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
    });

    const subset = usdaOnly ? rawRows.slice(-1590) : rawRows;
    console.log(`   Total rows: ${rawRows.length}, auditing: ${subset.length}`);

    // ── Enrich with macros ────────────────────────────────────────────────────
    console.log('🔬 Fetching macro data from food caches...');
    const rows = await enrichWithMacros(subset);
    const withMacros    = rows.filter(r => !r.macroMissing).length;
    const withoutMacros = rows.filter(r =>  r.macroMissing).length;
    console.log(`   Macros found: ${withMacros}  Missing: ${withoutMacros}`);
    console.log('');

    const batches = chunk(rows, batchSize);
    console.log(`   Batches: ${batches.length} × up to ${batchSize} entries\n`);

    if (isDryRun) {
        console.log('🔍 DRY RUN — first 2 batches:\n');
        for (const [i, batch] of batches.slice(0, 2).entries()) {
            console.log(`── Batch ${i} ──`);
            console.log(buildUserPrompt(batch));
            console.log('');
        }
        await prisma.$disconnect();
        return;
    }

    // ── Process batches ───────────────────────────────────────────────────────
    let okCount = 0;

    for (const [batchIdx, batch] of batches.entries()) {
        if (doneSet.has(batchIdx)) {
            process.stdout.write(`[${String(batchIdx+1).padStart(3)}/${batches.length}] ⏭  skipped\n`);
            continue;
        }

        process.stdout.write(`[${String(batchIdx+1).padStart(3)}/${batches.length}] 🔍 auditing ${batch.length} entries...`);

        let verdicts: EntryVerdict[];
        try {
            verdicts = await callGemini(batch, model);
        } catch (err) {
            console.error(`\n   ❌ failed: ${(err as Error).message}, retrying in 5s...`);
            await sleep(5000);
            try {
                verdicts = await callGemini(batch, model);
            } catch (err2) {
                console.error(`   ❌ retry failed: ${(err2 as Error).message} — skipping`);
                continue;
            }
        }

        const flags     = verdicts.filter(v => v.verdict === 'FLAG');
        const uncertain = verdicts.filter(v => v.verdict === 'UNCERTAIN');
        const ok        = verdicts.filter(v => v.verdict === 'OK');

        okCount += ok.length;
        state.flagged.push(...flags);
        state.uncertain.push(...uncertain);
        state.processedBatches.push(batchIdx);
        saveState();

        const parts = [
            ok.length        ? `${ok.length} OK` : '',
            uncertain.length ? `${uncertain.length} UNCERTAIN` : '',
            flags.length     ? `${flags.length} FLAG` : '',
        ].filter(Boolean);
        console.log(`  ${parts.join('  ')}`);

        for (const f of flags) {
            const food = f.brandName ? `${f.foodName} (${f.brandName})` : f.foodName;
            console.log(`     🚩 "${f.rawIngredient}" → "${food}"`);
            console.log(`        macros: ${formatMacros(f.macros)}`);
            console.log(`        ${f.reason}`);
        }
        for (const u of uncertain) {
            const food = u.brandName ? `${u.foodName} (${u.brandName})` : u.foodName;
            console.log(`     ⚠️  "${u.rawIngredient}" → "${food}"`);
            console.log(`        macros: ${formatMacros(u.macros)}`);
            console.log(`        ${u.reason}`);
        }

        if (batchIdx < batches.length - 1) await sleep(delayMs);
    }

    // ── Final report ──────────────────────────────────────────────────────────
    const total     = rows.length;
    const nFlagged  = state.flagged.length;
    const nUncertain = state.uncertain.length;

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  AI MAPPING AUDIT COMPLETE');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Entries audited  : ${total}`);
    console.log(`  OK               : ${okCount}`);
    console.log(`  UNCERTAIN        : ${nUncertain}`);
    console.log(`  FLAG (errors)    : ${nFlagged}`);
    console.log(`  Error rate       : ${((nFlagged / total) * 100).toFixed(1)}%`);

    // Write JSON
    const jsonReport = {
        auditedAt: new Date().toISOString(), model,
        totalEntries: total, ok: okCount, uncertain: nUncertain, flagged: nFlagged,
        flaggedEntries: state.flagged,
        uncertainEntries: state.uncertain,
    };
    const jsonPath = `${REPORT_BASE}.json`;
    fs.writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');

    // Write text report
    const lines: string[] = [
        `AI Mapping Audit — ${new Date().toISOString()}`,
        `Model: ${model}  |  Audited: ${total}  |  OK: ${okCount}  |  FLAG: ${nFlagged}  |  UNCERTAIN: ${nUncertain}`,
        '',
    ];

    const writeSection = (title: string, entries: EntryVerdict[]) => {
        if (entries.length === 0) return;
        lines.push(`══ ${title} (${entries.length}) ══`);
        for (const e of entries) {
            const food = e.brandName ? `${e.foodName} (${e.brandName})` : e.foodName;
            lines.push(`  "${e.rawIngredient}" → "${food}"`);
            lines.push(`  macros: ${formatMacros(e.macros)}`);
            lines.push(`  reason: ${e.reason}`);
            lines.push(`  id: ${e.id}`);
            lines.push('');
        }
    };

    writeSection('FLAGGED — should be purged', state.flagged);
    writeSection('UNCERTAIN — review manually', state.uncertain);

    fs.writeFileSync(`${REPORT_BASE}.txt`, lines.join('\n'), 'utf-8');

    // Write purge list
    if (nFlagged > 0) {
        const purgeList = state.flagged.map(f => ({
            id: f.id, rawIngredient: f.rawIngredient, foodName: f.foodName, reason: f.reason,
        }));
        const purgePath = `${REPORT_BASE}-purge-list.json`;
        fs.writeFileSync(purgePath, JSON.stringify(purgeList, null, 2), 'utf-8');
        console.log(`\n📋 Purge list (${nFlagged} entries): ${purgePath}`);
    }

    console.log(`📄 JSON : ${jsonPath}`);
    console.log(`📄 Text : ${REPORT_BASE}.txt`);

    await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
