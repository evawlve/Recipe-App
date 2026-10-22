/**
 * import-fatsecret-food.ts — mirror ONE (or a few) genuine FatSecret record(s) by id
 * into `FatSecretFood`, so a later `apply-repoints.ts` batch can aim a cache key at it.
 *
 * Why this exists (chain-dish repoint plan, 2026-10-19 §4): the only honest way to map
 * a line to a food we hold no record for — a Costco food-court hot dog, a per-slice
 * Domino's pizza — is to import the upstream record itself. A hand-written panel under
 * a provider's name crosses the attribution boundary; an `AiGeneratedFood` cannot be the
 * target of a `FoodMapping` row. The lane already owns the one-record refetch
 * (`ensureFatSecretParentPersisted()` → `client.getFood(fsId)` → `persistFatSecretHits()`),
 * but only the save path calls it. This script exposes it, nothing more.
 *
 * It is a WRITE to an upstream mirror (`FatSecretFood` + its servings), so it refuses to
 * write without `--apply`, and every id must be numeric (the bare FatSecret id, no `fs_`
 * prefix) or the whole run is refused before any read. A record the lane could not fetch
 * (no credentials, 404, rate limit) is reported ABSENT and the exit code is 1; the lane
 * logs the reason under `fatsecret_lane.parent_refetch_*`.
 *
 * Run from the repo root on a machine whose env carries the FatSecret credentials:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/import-fatsecret-food.ts <fsId> [<fsId> …]            # dry run: reads only
 *   … scripts/eval/import-fatsecret-food.ts <fsId> [<fsId> …] --apply    # refetch + mirror
 */
import 'dotenv/config';

export interface ImportArgs {
    fsIds: string[];
    apply: boolean;
}

export type ImportOutcome = 'ALREADY_MIRRORED' | 'DRY_RUN' | 'IMPORTED' | 'ABSENT';

/** Fail closed: no ids, or any non-numeric id, refuses the whole run. Duplicates collapse. */
export function parseImportArgs(argv: string[]): ImportArgs {
    const apply = argv.includes('--apply');
    const positional = argv.filter(a => a !== '--apply');
    if (positional.length === 0) throw new Error('usage: import-fatsecret-food.ts <fsId> [<fsId> …] [--apply]');
    const bad = positional.filter(a => !/^\d+$/.test(a));
    if (bad.length > 0) {
        throw new Error(`refusing: not a bare numeric FatSecret id: ${bad.join(', ')} (drop any fs_ prefix)`);
    }
    return { fsIds: [...new Set(positional)], apply };
}

/** Exit 1 iff an --apply run left any requested record absent. */
export function exitCodeFor(outcomes: ImportOutcome[]): number {
    return outcomes.includes('ABSENT') ? 1 : 0;
}

async function main(): Promise<void> {
    const { fsIds, apply } = parseImportArgs(process.argv.slice(2));
    const { prisma } = await import('../../src/lib/db');
    const { ensureFatSecretParentPersisted } = await import('../../src/lib/mapping/fatsecret-lane');
    const read = (fsId: string) =>
        prisma.fatSecretFood.findUnique({ where: { fsId }, select: { fsId: true, name: true, brandName: true } });

    console.log(`${fsIds.length} id(s) — ${apply ? 'APPLYING' : 'DRY RUN'}`);
    const outcomes: ImportOutcome[] = [];
    for (const fsId of fsIds) {
        const before = await read(fsId);
        if (before) {
            console.log(`  ${fsId}: ALREADY MIRRORED — ${before.name}${before.brandName ? ` [${before.brandName}]` : ''}`);
            outcomes.push('ALREADY_MIRRORED');
            continue;
        }
        if (!apply) {
            console.log(`  ${fsId}: not mirrored — would refetch (re-run with --apply)`);
            outcomes.push('DRY_RUN');
            continue;
        }
        await ensureFatSecretParentPersisted(fsId);
        const after = await read(fsId);
        if (after) {
            console.log(`  ${fsId}: IMPORTED — ${after.name}${after.brandName ? ` [${after.brandName}]` : ''}`);
            outcomes.push('IMPORTED');
        } else {
            console.log(`  ${fsId}: ABSENT — the lane could not fetch it (see fatsecret_lane.parent_refetch_* in the log)`);
            outcomes.push('ABSENT');
        }
    }
    await prisma.$disconnect();
    process.exitCode = exitCodeFor(outcomes);
}

if (require.main === module) {
    main().catch(err => {
        console.error(err instanceof Error ? err.message : err);
        process.exit(2);
    });
}
