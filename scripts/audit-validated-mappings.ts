/**
 * Audit Validated Mappings — Phase 6 Cache Quality Audit
 *
 * Scans all ValidatedMapping rows and flags suspect entries:
 *   LOW_CONF        — aiConfidence < 0.75
 *   STALE           — lastUsedAt > 60 days AND usedCount < 5
 *   DUPLICATE_KEY   — two different normalizedForm values → same foodId
 *   SYNONYM_DRIFT   — 0 token overlap between normalizedForm and (foodName + brandName)
 *   POSSIBLE_POISON — aiConfidence ≥ 0.9 AND 0 token overlap (normalizedForm is sorted tokens, not natural English)
 *
 * Output:
 *   logs/validated-mapping-audit-<timestamp>.txt   — full flagged report
 *   logs/to_delete.json                            — starter file for purge script (manual curation needed)
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/audit-validated-mappings.ts
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { singularize } from '../src/lib/fatsecret/normalization-rules';

const prisma = new PrismaClient();

// ─── Flag thresholds ────────────────────────────────────────────────────────

const LOW_CONF_THRESHOLD = 0.75;
const STALE_DAYS = 60;
const STALE_MAX_USES = 5;
const POSSIBLE_POISON_CONF = 0.9;

// NOTE: normalizedForm is stored as SORTED TOKENS (canonical key), not natural English.
// e.g. "chicken breast" → stored as "breast chicken"
// Substring matching against foodName is therefore invalid — use token overlap.
// SYNONYM_DRIFT  = 0 token overlap between normalizedForm and (foodName + brandName)
// POSSIBLE_POISON = 0 token overlap AND aiConfidence ≥ POSSIBLE_POISON_CONF

// ─── Types ──────────────────────────────────────────────────────────────────

type Flag = 'LOW_CONF' | 'STALE' | 'DUPLICATE_KEY' | 'SYNONYM_DRIFT' | 'POSSIBLE_POISON';

interface MappingRow {
    id: string;
    normalizedForm: string;
    rawIngredient: string;
    foodId: string;
    foodName: string;
    brandName: string | null;
    source: string;
    aiConfidence: number;
    validationReason: string | null;
    usedCount: number;
    lastUsedAt: Date | null;
    createdAt: Date;
}

interface FlaggedEntry {
    entry: MappingRow;
    flags: Flag[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tokenize(s: string): Set<string> {
    return new Set(
        s.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean)
            .map(singularize)   // "Bananas" → "banana", "Mushrooms" → "mushroom"
    );
}

function tokenOverlap(a: string, b: string): number {
    const ta = tokenize(a);
    const tb = tokenize(b);
    let count = 0;
    for (const t of ta) {
        if (tb.has(t)) count++;
    }
    return count;
}

function daysSince(date: Date | null): number {
    if (!date) return Infinity;
    return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function formatDate(d: Date | null): string {
    return d ? d.toISOString().slice(0, 10) : 'never';
}

// Simple Levenshtein for near-duplicate detection (Task 3)
function editDistance(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
        Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log('🔍 Loading all ValidatedMapping entries...');

    const rows = await prisma.validatedMapping.findMany({
        orderBy: [{ source: 'asc' }, { foodId: 'asc' }, { normalizedForm: 'asc' }],
        select: {
            id: true,
            normalizedForm: true,
            rawIngredient: true,
            foodId: true,
            foodName: true,
            brandName: true,
            source: true,
            aiConfidence: true,
            validationReason: true,
            usedCount: true,
            lastUsedAt: true,
            createdAt: true,
        },
    }) as MappingRow[];

    console.log(`✅ Loaded ${rows.length} entries.\n`);

    // ── Pass 1: Build foodId → rows map for DUPLICATE_KEY detection ──────────
    const byFoodId = new Map<string, MappingRow[]>();
    for (const row of rows) {
        const key = `${row.source}::${row.foodId}`;
        const bucket = byFoodId.get(key) ?? [];
        bucket.push(row);
        byFoodId.set(key, bucket);
    }

    // ── Pass 2: Flag each entry ───────────────────────────────────────────────
    const flagged: FlaggedEntry[] = [];
    const summaryCounts: Record<Flag, number> = {
        LOW_CONF: 0,
        STALE: 0,
        DUPLICATE_KEY: 0,
        SYNONYM_DRIFT: 0,
        POSSIBLE_POISON: 0,
    };

    for (const row of rows) {
        const flags: Flag[] = [];

        // LOW_CONF
        if (row.aiConfidence < LOW_CONF_THRESHOLD) {
            flags.push('LOW_CONF');
        }

        // STALE
        if (daysSince(row.lastUsedAt) > STALE_DAYS && row.usedCount < STALE_MAX_USES) {
            flags.push('STALE');
        }

        // DUPLICATE_KEY — flagged on any entry in a group with 2+ members
        const bucket = byFoodId.get(`${row.source}::${row.foodId}`) ?? [];
        if (bucket.length > 1) {
            flags.push('DUPLICATE_KEY');
        }

        // Build the combined food target for token comparison.
        // We include brandName because some normalized forms contain a brand token
        // (e.g. "oat quaker" → foodName "Oats", brandName "Quaker").
        const foodTarget = [row.foodName, row.brandName].filter(Boolean).join(' ');
        const overlap = tokenOverlap(row.normalizedForm, foodTarget);

        // SYNONYM_DRIFT — ZERO token overlap between normalizedForm and (foodName + brandName).
        // A single shared token (e.g. "pine" in "nut pine" → "Pine Nuts") is a valid match.
        // Only flag when there is NO semantic relationship whatsoever.
        if (overlap === 0) {
            flags.push('SYNONYM_DRIFT');
        }

        // POSSIBLE_POISON — high confidence AND zero token overlap.
        // This is a strict subset of SYNONYM_DRIFT: the dangerous case is a
        // high-confidence entry with no token connection to the stored food.
        // e.g. "apple pie spice" → "Apple Chips" (0 overlap, 0.98 confidence).
        if (row.aiConfidence >= POSSIBLE_POISON_CONF && overlap === 0) {
            flags.push('POSSIBLE_POISON');
        }

        if (flags.length > 0) {
            flagged.push({ entry: row, flags });
            for (const f of flags) summaryCounts[f]++;
        }
    }

    // ── Pass 3: Near-duplicate normalizedForm keys → different foodId (Task 3) ─
    const nearDuplicatePairs: Array<{ a: MappingRow; b: MappingRow; dist: number }> = [];
    const rowsBySource = rows.reduce<Map<string, MappingRow[]>>((acc, r) => {
        const bucket = acc.get(r.source) ?? [];
        bucket.push(r);
        acc.set(r.source, bucket);
        return acc;
    }, new Map());

    for (const [, sourceRows] of rowsBySource) {
        for (let i = 0; i < sourceRows.length; i++) {
            for (let j = i + 1; j < sourceRows.length; j++) {
                const a = sourceRows[i];
                const b = sourceRows[j];
                // Only flag pairs resolving to DIFFERENT foods
                if (a.foodId === b.foodId) continue;
                const dist = editDistance(a.normalizedForm, b.normalizedForm);
                if (dist <= 2) {
                    nearDuplicatePairs.push({ a, b, dist });
                }
            }
        }
    }

    // ─── Build report ──────────────────────────────────────────────────────────

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '..', 'logs');
    const outputPath = path.join(logDir, `validated-mapping-audit-${timestamp}.txt`);
    const toDeletePath = path.join(logDir, 'to_delete.json');

    const lines: string[] = [];

    lines.push('═══════════════════════════════════════════════════════════════════');
    lines.push('  ValidatedMapping Cache Quality Audit');
    lines.push(`  Generated: ${new Date().toISOString()}`);
    lines.push(`  Total entries scanned: ${rows.length}`);
    lines.push(`  Total flagged entries: ${flagged.length}`);
    lines.push('═══════════════════════════════════════════════════════════════════');
    lines.push('');
    lines.push('FLAG SUMMARY');
    lines.push('───────────────────────────────────────────────────────────────────');
    for (const [flag, count] of Object.entries(summaryCounts)) {
        lines.push(`  ${flag.padEnd(16)} ${String(count).padStart(4)} entries`);
    }
    lines.push('');

    // ── Section 1: POSSIBLE_POISON (highest risk — review first) ──────────────
    const poisonEntries = flagged.filter(f => f.flags.includes('POSSIBLE_POISON'));
    const poisonCount = poisonEntries.length;
    lines.push(`═══ POSSIBLE_POISON (${poisonCount}) ═══════════════════════════════════════════════════════════`);
    lines.push('  aiConfidence ≥ 0.9 AND zero token overlap between normalizedForm and (foodName + brandName).');
    lines.push('  True semantic inversions — e.g. "apple pie spice" → "Apple Chips" [0 overlap, high conf].');
    lines.push('  NOTE: normalizedForm is sorted tokens, so substring matching is invalid here.');
    lines.push('');
    for (const { entry, flags } of poisonEntries) {
        lines.push(`  [${flags.join(', ')}]`);
        lines.push(`  normalizedForm : "${entry.normalizedForm}"`);
        lines.push(`  foodName       : "${entry.foodName}"${entry.brandName ? ` (${entry.brandName})` : ''}`);
        lines.push(`  foodId         : ${entry.foodId}  source: ${entry.source}`);
        lines.push(`  aiConfidence   : ${entry.aiConfidence.toFixed(3)}   usedCount: ${entry.usedCount}   lastUsed: ${formatDate(entry.lastUsedAt)}`);
        lines.push(`  reason         : ${entry.validationReason ?? '(none)'}`);
        lines.push('');
    }

    // ── Section 2: SYNONYM_DRIFT (high risk) ──────────────────────────────────
    const driftEntries = flagged.filter(f => f.flags.includes('SYNONYM_DRIFT') && !f.flags.includes('POSSIBLE_POISON'));
    lines.push(`═══ SYNONYM_DRIFT (${driftEntries.length}) — zero overlap, not already in POSSIBLE_POISON ═══════════`);
    lines.push('  Zero token overlap between normalizedForm and (foodName + brandName), but aiConfidence < 0.9.');
    lines.push('  Lower-confidence entries that also have no semantic token connection.');
    lines.push('');
    for (const { entry, flags } of driftEntries) {
        lines.push(`  [${flags.join(', ')}]`);
        lines.push(`  normalizedForm : "${entry.normalizedForm}"`);
        lines.push(`  foodName       : "${entry.foodName}"${entry.brandName ? ` (${entry.brandName})` : ''}`);
        lines.push(`  foodId         : ${entry.foodId}  source: ${entry.source}`);
        lines.push(`  aiConfidence   : ${entry.aiConfidence.toFixed(3)}   usedCount: ${entry.usedCount}   lastUsed: ${formatDate(entry.lastUsedAt)}`);
        lines.push(`  reason         : ${entry.validationReason ?? '(none)'}`);
        lines.push('');
    }

    // ── Section 3: LOW_CONF ───────────────────────────────────────────────────
    const lowConfEntries = flagged.filter(f => f.flags.includes('LOW_CONF'));
    lines.push(`═══ LOW_CONF (${lowConfEntries.length}) — aiConfidence < ${LOW_CONF_THRESHOLD} ════════════════════`);
    lines.push('');
    for (const { entry, flags } of lowConfEntries) {
        lines.push(`  [${flags.join(', ')}]`);
        lines.push(`  normalizedForm : "${entry.normalizedForm}"  →  "${entry.foodName}"${entry.brandName ? ` (${entry.brandName})` : ''}`);
        lines.push(`  aiConfidence   : ${entry.aiConfidence.toFixed(3)}   usedCount: ${entry.usedCount}   lastUsed: ${formatDate(entry.lastUsedAt)}`);
        lines.push('');
    }

    // ── Section 4: STALE ──────────────────────────────────────────────────────
    const staleEntries = flagged.filter(f => f.flags.includes('STALE'));
    lines.push(`═══ STALE (${staleEntries.length}) — not used in ${STALE_DAYS}+ days AND usedCount < ${STALE_MAX_USES} ════`);
    lines.push('');
    for (const { entry, flags } of staleEntries) {
        lines.push(`  [${flags.join(', ')}]`);
        lines.push(`  normalizedForm : "${entry.normalizedForm}"  →  "${entry.foodName}"`);
        lines.push(`  usedCount: ${entry.usedCount}   lastUsed: ${formatDate(entry.lastUsedAt)}   created: ${formatDate(entry.createdAt)}`);
        lines.push('');
    }

    // ── Section 5: DUPLICATE_KEY groups ───────────────────────────────────────
    lines.push(`═══ DUPLICATE_KEY (${summaryCounts.DUPLICATE_KEY} entries across ${[...byFoodId.values()].filter(b => b.length > 1).length} food groups) ════`);
    lines.push('  Multiple normalizedForm keys → same foodId.');
    lines.push('  Groups with 3+ keys, or inconsistent foodName, are compaction candidates.');
    lines.push('');
    const dupGroups = [...byFoodId.entries()]
        .filter(([, bucket]) => bucket.length > 1)
        .sort((a, b) => b[1].length - a[1].length);

    for (const [groupKey, bucket] of dupGroups) {
        const foodNames = new Set(bucket.map(r => r.foodName));
        const hasInconsistentFoodNames = foodNames.size > 1;
        const marker = hasInconsistentFoodNames ? '⚠️ INCONSISTENT foodName' : '✅ consistent';
        lines.push(`  foodId: ${groupKey}  [${bucket.length} keys]  ${marker}`);
        for (const r of bucket) {
            lines.push(`    normalizedForm: "${r.normalizedForm}"  →  "${r.foodName}"   used: ${r.usedCount}×`);
        }
        lines.push('');
    }

    // ── Section 6: Near-duplicate normalizedForm → different foodId ───────────
    lines.push(`═══ NEAR-DUPLICATE KEYS → DIFFERENT foodId (${nearDuplicatePairs.length} pairs) ════════`);
    lines.push('  Edit distance ≤ 2 but pointing to DIFFERENT foods.');
    lines.push('  These are the true deduplication problem—same query → two different foods.');
    lines.push('');
    for (const { a, b, dist } of nearDuplicatePairs.slice(0, 200)) {  // Cap output for readability
        lines.push(`  dist=${dist}  "${a.normalizedForm}" (${a.source})`);
        lines.push(`         → "${a.foodName}"  [${a.foodId}]`);
        lines.push(`       "${b.normalizedForm}" (${b.source})`);
        lines.push(`         → "${b.foodName}"  [${b.foodId}]`);
        lines.push('');
    }
    if (nearDuplicatePairs.length > 200) {
        lines.push(`  ... and ${nearDuplicatePairs.length - 200} more pairs (truncated for readability)`);
    }

    // ── Write report ───────────────────────────────────────────────────────────
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`📄 Audit report written to: ${outputPath}`);

    // ── Write to_delete.json starter ──────────────────────────────────────────
    // Only pre-populate with highest-confidence poison entries as a starting point.
    // Human reviewer must curate this before running purge-bad-mappings.ts.
    const toDeleteCandidates = poisonEntries
        .filter(({ entry }) => entry.usedCount <= 3)  // Low-usage poison entries are safest auto-candidates
        .map(({ entry }) => ({
            normalizedForm: entry.normalizedForm,
            source: entry.source,
            foodName: entry.foodName,
            reason: 'POSSIBLE_POISON — auto-candidate, verify before purge',
        }));

    // Only write to_delete.json if it doesn't exist (don't overwrite human curation)
    if (!fs.existsSync(toDeletePath)) {
        fs.writeFileSync(
            toDeletePath,
            JSON.stringify(toDeleteCandidates, null, 2),
            'utf-8'
        );
        console.log(`📋 Starter to_delete.json written to: ${toDeletePath}`);
        console.log(`   ⚠️  Review and curate this file before running purge-bad-mappings.ts!`);
    } else {
        console.log(`ℹ️  to_delete.json already exists — skipping overwrite (manual curation preserved).`);
    }

    // ── Print summary ──────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════');
    console.log('  AUDIT SUMMARY');
    console.log('══════════════════════════════════════════');
    console.log(`  Total entries       : ${rows.length}`);
    console.log(`  Total flagged       : ${flagged.length} (${((flagged.length / rows.length) * 100).toFixed(1)}%)`);
    console.log('');
    for (const [flag, count] of Object.entries(summaryCounts)) {
        console.log(`  ${flag.padEnd(16)} : ${count}`);
    }
    console.log(`  Near-dup pairs      : ${nearDuplicatePairs.length}`);
    console.log('');
    console.log('  Review order (highest risk first):');
    console.log('    1. POSSIBLE_POISON  — semantic inversions at high confidence');
    console.log('    2. SYNONYM_DRIFT    — low semantic similarity');
    console.log('    3. LOW_CONF         — weak AI validation signal');
    console.log('    4. STALE            — rarely used, can safely evict');
    console.log('    5. DUPLICATE_KEY    — review inconsistent foodName groups only');
    console.log('    6. Near-dup pairs   — same query string → different foods');

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});
