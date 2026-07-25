/**
 * migrate-possessive-keys.ts — one-shot key migration for the apostrophe fix.
 *
 * WHY: canonicalizeCacheKey used to keep apostrophes and then hand the possessive
 * `s` to singularize(), so "mcdonald's fries" stored under "fry mcdonald'" while
 * "mcdonalds fries" stored under "fry mcdonald". Because the key basis is whatever
 * spelling the LLM emitted, which row a user hit was effectively random — live on
 * the box before this migration, "mcdonalds fries" returned McDonald's Fries Medium
 * (114g) and "mcdonald's fries" returned a generic unbranded Fries (250g). The fix
 * deletes apostrophes before tokenizing; this script moves the 108 rows that were
 * written under the old scheme so they stay reachable.
 *
 * THE TARGET KEY IS NOT canonicalizeCacheKey(storedKey). A stored key has already
 * been singularized once, lossily: the raw token "reese's" was chopped to "reese'".
 * Re-canonicalizing "reese'" gives "reese", but a live lookup for the raw name
 * "reese's puffs" computes "rees"/"reese" from the ORIGINAL spelling — so the row
 * would land on a key nothing asks for. This script restores the possessive first
 * ("reese'" -> "reese's") and then canonicalizes, which reproduces exactly what the
 * live lookup path will compute. Verified: 0 stranded rows, 0 non-fixed-point keys.
 *
 * MERGE POLICY: when a mangled key collides with an existing apostrophe-free twin,
 * the twin wins and the mangled row is deleted. That direction was checked against
 * all 11 real collisions on the box — in every case where the two rows disagreed on
 * substance the apostrophe-free row held the better record, including two
 * human-triage 0.99 rows ("Mandarin Orange Chicken", "Classic Lasagna with Meat").
 * Note AI confidence pointed the WRONG way in the two worst cases (generic unbranded
 * "Fries" carried 0.980 against McDonald's Fries Medium at 0.880), so a
 * confidence-ranked merge would have picked the bad row. usedCount is summed and
 * lastUsedAt keeps the later of the two so telemetry is not lost.
 *
 * SAFETY: if the row being deleted is human-triage and the surviving row is not,
 * the script copies the human record onto the survivor rather than discarding a
 * human decision. No FK references FoodMapping.normalizedForm, so renames are safe.
 * Dry-run by default; --apply performs writes inside a transaction.
 *
 * Run (from repo root, DATABASE_URL pointing at the target DB):
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/migrate-possessive-keys.ts [--apply]
 */

import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../src/lib/mapping/normalization-rules';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/**
 * Undo the old singularize() chop, then canonicalize under the new rules.
 * A token ending in a bare apostrophe was "<token>'s" before singularize() ran.
 */
export function migrateKey(storedKey: string): string {
    return canonicalizeCacheKey(storedKey.replace(/(\S)'(?=\s|$)/g, "$1's"));
}

interface Row {
    normalizedForm: string;
    foodName: string;
    brandName: string | null;
    source: string;
    offBarcode: string | null;
    fdcId: number | null;
    fsId: string | null;
    aiConfidence: number;
    validatedBy: string;
    usedCount: number;
    lastUsedAt: Date;
}

async function main() {
    const rows = (await prisma.foodMapping.findMany({
        select: {
            normalizedForm: true, foodName: true, brandName: true, source: true,
            offBarcode: true, fdcId: true, fsId: true, aiConfidence: true,
            validatedBy: true, usedCount: true, lastUsedAt: true,
        },
    })) as Row[];

    const byKey = new Map(rows.map(r => [r.normalizedForm, r]));
    const renames: Array<{ row: Row; to: string }> = [];
    const merges: Array<{ loser: Row; winner: Row }> = [];

    for (const row of rows) {
        const to = migrateKey(row.normalizedForm);
        if (to === row.normalizedForm) continue;
        const winner = byKey.get(to);
        if (winner) merges.push({ loser: row, winner });
        else renames.push({ row, to });
    }

    // Two mangled keys can also collapse onto each other with no existing twin.
    const renameTargets = new Map<string, Array<{ row: Row; to: string }>>();
    for (const r of renames) {
        if (!renameTargets.has(r.to)) renameTargets.set(r.to, []);
        renameTargets.get(r.to)!.push(r);
    }
    const pairMerges: Array<{ loser: Row; winner: Row }> = [];
    const cleanRenames: Array<{ row: Row; to: string }> = [];
    for (const [, group] of renameTargets) {
        if (group.length === 1) { cleanRenames.push(group[0]); continue; }
        // Keep the most-used row; fold the rest into it.
        const sorted = [...group].sort((a, b) => b.row.usedCount - a.row.usedCount);
        cleanRenames.push(sorted[0]);
        for (const l of sorted.slice(1)) pairMerges.push({ loser: l.row, winner: sorted[0].row });
    }
    const allMerges = [...merges, ...pairMerges];

    console.log(`FoodMapping rows        : ${rows.length}`);
    console.log(`renames                 : ${cleanRenames.length}`);
    console.log(`merges (row deleted)    : ${allMerges.length}`);
    console.log(`rows after              : ${rows.length - allMerges.length}`);
    console.log('');

    let humanRescues = 0;
    for (const m of allMerges) {
        const rescue = m.loser.validatedBy === 'human-triage' && m.winner.validatedBy !== 'human-triage';
        if (rescue) humanRescues++;
        console.log(`MERGE ${m.loser.normalizedForm}`);
        console.log(`   drop  : ${m.loser.foodName} / ${m.loser.brandName ?? '-'} [${m.loser.validatedBy} ${m.loser.aiConfidence.toFixed(3)} used=${m.loser.usedCount}]`);
        console.log(`   keep  : ${m.winner.foodName} / ${m.winner.brandName ?? '-'} [${m.winner.validatedBy} ${m.winner.aiConfidence.toFixed(3)} used=${m.winner.usedCount}]${rescue ? '  <-- HUMAN RECORD COPIED FROM DROPPED ROW' : ''}`);
    }
    if (humanRescues) console.log(`\n${humanRescues} merge(s) preserve a human-triage record from the dropped row.`);

    if (!APPLY) {
        console.log('\nDRY RUN — pass --apply to write. Snapshot FoodMapping first.');
        for (const r of cleanRenames.slice(0, 10)) console.log(`  RENAME ${r.row.normalizedForm}  ->  ${r.to}`);
        if (cleanRenames.length > 10) console.log(`  ... and ${cleanRenames.length - 10} more renames`);
        await prisma.$disconnect();
        return;
    }

    await prisma.$transaction(async tx => {
        // Merges first: deleting the loser frees the key space before any rename
        // could collide with it.
        for (const m of allMerges) {
            const data: Record<string, unknown> = {
                usedCount: m.winner.usedCount + m.loser.usedCount,
                lastUsedAt: m.loser.lastUsedAt > m.winner.lastUsedAt ? m.loser.lastUsedAt : m.winner.lastUsedAt,
            };
            if (m.loser.validatedBy === 'human-triage' && m.winner.validatedBy !== 'human-triage') {
                Object.assign(data, {
                    foodName: m.loser.foodName, brandName: m.loser.brandName, source: m.loser.source,
                    offBarcode: m.loser.offBarcode, fdcId: m.loser.fdcId, fsId: m.loser.fsId,
                    aiConfidence: m.loser.aiConfidence, validatedBy: m.loser.validatedBy,
                });
            }
            await tx.foodMapping.delete({ where: { normalizedForm: m.loser.normalizedForm } });
            await tx.foodMapping.update({ where: { normalizedForm: m.winner.normalizedForm }, data });
        }
        for (const r of cleanRenames) {
            await tx.foodMapping.update({
                where: { normalizedForm: r.row.normalizedForm },
                data: { normalizedForm: r.to },
            });
        }
    }, { timeout: 120_000 });

    const after = await prisma.foodMapping.count();
    const stillMangled = await prisma.foodMapping.count({ where: { normalizedForm: { contains: "'" } } });
    console.log(`\nAPPLIED. rows now: ${after}  |  keys still holding an apostrophe: ${stillMangled} (expect 0)`);
    await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
