/**
 * backfill-ai-normalize-keys.ts — re-key the AiNormalizeCache rows that the current
 * computeNormalizedKey() can no longer reach, and merge the collisions that creates.
 *
 * WHY. Two changes landed together on 2026-08-01:
 *   1. aiSimplifyIngredient stopped concatenating its `SIMPLIFY:` / `B:<brand>:` namespace
 *      onto rawLine before normalization. Concatenated, the prefix went through
 *      parseIngredientLine + normalizeIngredientName as if it were food, so quantities
 *      survived into the key and the prefix itself was rewritten.
 *   2. refreshNormalizationRules() stopped merging table-derived prepPhrases into the
 *      global normalizer, so key computation no longer depends on table contents.
 * Both move keys. A row under an old key is not WRONG, it is UNREACHABLE: the lookup
 * misses, re-derives through the LLM and writes a new row. This script recovers them.
 *
 * ORDER MATTERS. Deploy the code FIRST, then run this. Running it against the old key
 * function would strand the rows it is meant to rescue, so main() refuses to run unless
 * the loaded computeNormalizedKey has the new shape (see assertNewKeyFunctionLoaded).
 *
 * MEASURED against a live dump of all 2864 rows on 2026-08-01
 * (re-derive: run this script with no flags — dry-run is the default):
 *   257 rows change key   (233 of the 233 SIMPLIFY rows, 24 plain rows)
 *   6 merge groups, 12 rows, 0 conflicting non-null estimatedCaloriesPer100g,
 *   0 conflicting isBranded  ->  net 2864 -> 2858
 * The win is not the row count. It is that 'simplify 1 cup rolled oats' (useCount=167)
 * collapses onto its quantity-free form and the 24 stranded rows become reachable again.
 *
 * MERGING IS THE DANGEROUS PART. estimatedCaloriesPer100g and isBranded feed simpleRerank
 * through map-ingredient-with-fallback.ts, so fusing two rows that disagree on either would
 * silently change which candidate wins a mapping. This script does not apply a policy to
 * that: it HARD ABORTS the whole transaction. The counts above were measured on a dump,
 * not at apply time, so the groups are recomputed inside the transaction.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register \
 *     scripts/backfill-ai-normalize-keys.ts            # dry-run (default): report only
 *   npx ts-node --project tsconfig.scripts.json -r tsconfig-paths/register \
 *     scripts/backfill-ai-normalize-keys.ts --apply    # write, in ONE transaction
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { computeNormalizedKey } from '../src/lib/mapping/validated-mapping-helpers';

/** The columns the plan needs. Anything else is copied by the merge, not read by it. */
export interface CacheRow {
    normalizedKey: string;
    rawLine: string | null;
    useCount: number;
    lastUsedAt: Date;
    isBranded: boolean;
    estimatedCaloriesPer100g: number | null;
}

export interface Rekey {
    from: string;
    to: string;
}

export interface Merge {
    key: string;
    winner: CacheRow;
    losers: CacheRow[];
}

export interface Plan {
    unchanged: CacheRow[];
    /** rawLine IS NULL — nothing to recompute from. Reported, never touched. */
    skipped: CacheRow[];
    rekeys: Rekey[];
    merges: Merge[];
}

/**
 * The namespace grammar aiSimplifyIngredient writes: `SIMPLIFY:` plus an optional
 * `B:<brand>:`. Brands have their colons stripped at write time so this split is total.
 */
const NAMESPACE_RE = /^(SIMPLIFY:(?:B:[^:]*:)?)/;

/**
 * Split a stored row into (namespace, food body).
 *
 * Two storage shapes exist and both must be handled, or the script stops being idempotent:
 *   - LEGACY rows, written before the fix, have the namespace inside rawLine
 *     ('SIMPLIFY:B:ghost:2 scoops ghost protein cinnamon roll') and a mangled key
 *     ('simplify b ghost 2 scoop ghost protein cinnamon roll').
 *   - MIGRATED rows have a bare rawLine and carry the namespace verbatim in the KEY.
 *     Deriving the namespace from rawLine alone would read those as un-namespaced and
 *     re-key 'SIMPLIFY:rice' to 'rice' on a second run.
 * MEASURED 2026-08-01 on all 2864 live rows: 233 have a rawLine starting 'SIMPLIFY:',
 * 99 of those continue 'B:', all 99 match the grammar above, and zero rows disagree
 * between the key prefix and the raw prefix.
 */
export function splitNamespace(row: CacheRow): { namespace: string; body: string } {
    const raw = row.rawLine ?? '';
    const legacy = NAMESPACE_RE.exec(raw);
    if (legacy) {
        return { namespace: legacy[1], body: raw.slice(legacy[1].length) };
    }
    const migrated = NAMESPACE_RE.exec(row.normalizedKey);
    if (migrated) {
        return { namespace: migrated[1], body: raw };
    }
    return { namespace: '', body: raw };
}

/**
 * Which row of a colliding group survives.
 *
 * 1. The row whose STORED key already equals the new key wins. It is the one live lookups
 *    are hitting today, so keeping it means no reachable row ever changes identity.
 * 2. Otherwise higher useCount — the better-attested derivation.
 * 3. Otherwise newer lastUsedAt. Without step 3 the live 'panera bacon turkey bravo' /
 *    'panera bacon turkey bravo sandwich' pair (both useCount=3, neither key equal to the
 *    new key) resolves on whatever order Postgres happened to return.
 */
export function chooseWinner(key: string, rows: CacheRow[]): CacheRow {
    const sorted = [...rows].sort((a, b) => {
        const aExact = a.normalizedKey === key ? 1 : 0;
        const bExact = b.normalizedKey === key ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        if (a.useCount !== b.useCount) return b.useCount - a.useCount;
        const at = new Date(a.lastUsedAt).getTime();
        const bt = new Date(b.lastUsedAt).getTime();
        if (at !== bt) return bt - at;
        // Total order, so a plan is reproducible even on a full tie.
        return a.normalizedKey < b.normalizedKey ? -1 : 1;
    });
    return sorted[0];
}

export class MergeConflictError extends Error {
    constructor(public readonly key: string, public readonly detail: string) {
        super(`refusing to merge onto "${key}": ${detail}`);
        this.name = 'MergeConflictError';
    }
}

/**
 * Build the whole plan. Throws MergeConflictError rather than choosing a winner when a
 * group disagrees on a value that feeds simpleRerank.
 */
export function planBackfill(
    rows: CacheRow[],
    keyFn: (body: string, namespace: string) => string = computeNormalizedKey,
): Plan {
    const plan: Plan = { unchanged: [], skipped: [], rekeys: [], merges: [] };
    const byNewKey = new Map<string, CacheRow[]>();

    for (const row of rows) {
        if (row.rawLine == null) {
            plan.skipped.push(row);
            continue;
        }
        const { namespace, body } = splitNamespace(row);
        const newKey = keyFn(body, namespace);
        const bucket = byNewKey.get(newKey);
        if (bucket) bucket.push(row);
        else byNewKey.set(newKey, [row]);
    }

    for (const [newKey, group] of byNewKey) {
        if (group.length === 1) {
            const row = group[0];
            // A no-op on an already-correct row is not free: it would turn a 257-row
            // migration into a 2864-row rewrite.
            if (row.normalizedKey === newKey) plan.unchanged.push(row);
            else plan.rekeys.push({ from: row.normalizedKey, to: newKey });
            continue;
        }

        const kcals = new Set(
            group.map(r => r.estimatedCaloriesPer100g).filter((v): v is number => v != null),
        );
        if (kcals.size > 1) {
            throw new MergeConflictError(
                newKey,
                `${kcals.size} distinct non-null estimatedCaloriesPer100g (${[...kcals].join(', ')}) `
                + `across ${group.map(r => JSON.stringify(r.normalizedKey)).join(', ')} — `
                + 'this value feeds simpleRerank and a merge would silently change a mapping outcome',
            );
        }
        const brands = new Set(group.map(r => r.isBranded));
        if (brands.size > 1) {
            throw new MergeConflictError(
                newKey,
                `distinct isBranded across ${group.map(r => JSON.stringify(r.normalizedKey)).join(', ')} — `
                + 'this value feeds simpleRerank and a merge would silently change a mapping outcome',
            );
        }

        const winner = chooseWinner(newKey, group);
        plan.merges.push({ key: newKey, winner, losers: group.filter(r => r !== winner) });
    }

    return plan;
}

/** The columns a merge fills on the winner from a loser when the winner's is NULL. */
const FILLABLE_COLUMNS = [
    'rawLine',
    'canonicalBase',
    'cookingModifier',
    'estimatedCaloriesPer100g',
    'estimatedProteinPer100g',
    'estimatedCarbsPer100g',
    'estimatedFatPer100g',
    'nutritionConfidence',
    'splitIngredients',
] as const;

/**
 * Refuse to run against the OLD key function. Deploying after this script would strand
 * exactly the rows it exists to rescue, and that failure is silent.
 */
export function assertNewKeyFunctionLoaded(
    keyFn: (body: string, namespace: string) => string = computeNormalizedKey,
): void {
    const withNs = keyFn('1 cup rice', 'SIMPLIFY:');
    if (withNs !== 'SIMPLIFY:rice') {
        throw new Error(
            `computeNormalizedKey('1 cup rice', 'SIMPLIFY:') returned ${JSON.stringify(withNs)}, `
            + 'expected "SIMPLIFY:rice". The deployed code is older than this script — '
            + 'deploy first, then run the backfill.',
        );
    }
}

async function main(): Promise<void> {
    const apply = process.argv.includes('--apply');
    const prisma = new PrismaClient();

    assertNewKeyFunctionLoaded();

    try {
        const rows = (await prisma.aiNormalizeCache.findMany({
            select: {
                normalizedKey: true,
                rawLine: true,
                useCount: true,
                lastUsedAt: true,
                isBranded: true,
                estimatedCaloriesPer100g: true,
            },
        })) as CacheRow[];

        const plan = planBackfill(rows);

        console.log(`rows                 ${rows.length}`);
        console.log(`unchanged            ${plan.unchanged.length}`);
        console.log(`skipped (rawLine=∅)  ${plan.skipped.length}`);
        console.log(`re-key               ${plan.rekeys.length}`);
        console.log(`merge groups         ${plan.merges.length}`);
        console.log(`rows deleted by merge ${plan.merges.reduce((a, m) => a + m.losers.length, 0)}`);
        console.log(
            `net rows             ${rows.length} -> `
            + `${rows.length - plan.merges.reduce((a, m) => a + m.losers.length, 0)}`,
        );
        for (const m of plan.merges) {
            console.log(
                `  MERGE ${JSON.stringify(m.key)} <- winner ${JSON.stringify(m.winner.normalizedKey)}`
                + ` (useCount ${m.winner.useCount}), losers `
                + m.losers.map(l => `${JSON.stringify(l.normalizedKey)} (useCount ${l.useCount})`).join(', '),
            );
        }
        for (const r of plan.rekeys.slice(0, 20)) {
            console.log(`  REKEY ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`);
        }
        if (plan.rekeys.length > 20) console.log(`  ... and ${plan.rekeys.length - 20} more`);

        if (!apply) {
            console.log('\ndry-run — nothing written. Re-run with --apply.');
            return;
        }

        await prisma.$transaction(async tx => {
            // 1. Merges: collapse each group onto its winner, WITHOUT moving keys yet.
            for (const m of plan.merges) {
                const full = await tx.aiNormalizeCache.findMany({
                    where: { normalizedKey: { in: [m.winner.normalizedKey, ...m.losers.map(l => l.normalizedKey)] } },
                });
                const winner = full.find(r => r.normalizedKey === m.winner.normalizedKey)!;
                const losers = full.filter(r => r.normalizedKey !== m.winner.normalizedKey);

                const fill: Record<string, unknown> = {};
                for (const col of FILLABLE_COLUMNS) {
                    if ((winner as Record<string, unknown>)[col] != null) continue;
                    const donor = losers.find(l => (l as Record<string, unknown>)[col] != null);
                    if (donor) fill[col] = (donor as Record<string, unknown>)[col];
                }

                await tx.aiNormalizeCache.deleteMany({
                    where: { normalizedKey: { in: losers.map(l => l.normalizedKey) } },
                });
                await tx.aiNormalizeCache.update({
                    where: { normalizedKey: winner.normalizedKey },
                    data: {
                        ...fill,
                        useCount: full.reduce((a, r) => a + r.useCount, 0),
                        lastUsedAt: new Date(
                            Math.max(...full.map(r => new Date(r.lastUsedAt).getTime())),
                        ),
                    },
                });
            }

            // 2. Key moves, in two phases through a temporary key.
            //    A key move can land on a key another row still holds and has not moved off
            //    yet (A -> B while B -> C), which would abort the whole transaction on the
            //    primary key. MEASURED 2026-08-01: zero such chains in the live 2864 rows,
            //    but that is a property of today's data, not of the migration, and the cost
            //    of not depending on it is one extra UPDATE per moved row.
            const moves = [
                ...plan.merges
                    .filter(m => m.winner.normalizedKey !== m.key)
                    .map(m => ({ from: m.winner.normalizedKey, to: m.key })),
                ...plan.rekeys,
            ];
            //   The temp key starts with a SPACE: computeNormalizedKey trims its result and
            //    every namespace starts with a letter, so no real key begins with one.
            const temp = (i: number) => ` backfill:${i}`;
            for (let i = 0; i < moves.length; i++) {
                await tx.aiNormalizeCache.update({
                    where: { normalizedKey: moves[i].from },
                    data: { normalizedKey: temp(i) },
                });
            }
            for (let i = 0; i < moves.length; i++) {
                await tx.aiNormalizeCache.update({
                    where: { normalizedKey: temp(i) },
                    data: { normalizedKey: moves[i].to },
                });
            }
        }, {
            // ~2 UPDATEs per moved row plus the merges. Prisma's 5s interactive default is
            // not enough headroom for a few hundred round-trips over the LAN.
            maxWait: 30_000,
            timeout: 300_000,
        });

        console.log('\napplied.');
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
