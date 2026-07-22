/**
 * fix-malformed-cache-keys.ts — find (and optionally delete) FoodMapping rows
 * whose normalizedForm was mangled by the pre-Track-1c write path.
 *
 * The defect (fixed in src/lib/mapping/cache-key.ts deriveMappingCacheKey):
 * the save site prepended the detected brand with a substring includes()
 * guard that singularization defeats — querying "oikos" wrote "oiko oiko"
 * while reads derived "oiko" — and composed keys over already-doubled
 * normalized names ("canned canned kidney beans"). canonicalizeCacheKey
 * sorts + singularizes but never dedupes, so every such key is stored with
 * the same token twice. These rows are DEAD: no read path can ever derive
 * their key, so the row occupies the table while its query re-runs the full
 * pipeline forever.
 *
 * Detection (two classes, both reported):
 *   1. adjacent-dup — the stored key literally repeats a token back-to-back
 *      ("oiko oiko", "bean canned canned kidney").
 *   2. stem-dup — after re-canonicalizing the stored key (sort + singularize)
 *      two tokens collapse onto the same stem ("oiko oikos", legacy unsorted
 *      "oikos greek oiko yogurt"). Doubled brand prefixes whose copies differ
 *      only by plurality land here.
 *   Rows whose duplicated stem matches a known brand are labeled
 *   doubled-brand-prefix for the report.
 *
 * Deletion is safe: the next query for that food re-resolves through the
 * fixed pipeline and re-caches under the correct symmetric key.
 *
 * Usage:
 *   npx ts-node scripts/fix-malformed-cache-keys.ts            # dry-run (default): report only
 *   npx ts-node scripts/fix-malformed-cache-keys.ts --dry-run  # same, explicit
 *   npx ts-node scripts/fix-malformed-cache-keys.ts --apply    # DELETE the malformed rows
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../src/lib/mapping/normalization-rules';
import { collapseAdjacentDuplicateTokens, isMalformedCacheKey } from '../src/lib/mapping/cache-key';
import { isBrandedIngredient } from '../src/lib/mapping/brand-detector';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

interface Finding {
    normalizedForm: string;
    foodId: string;
    foodName: string;
    usedCount: number;
    validatedBy: string;
    reason: string;
}

function tokens(key: string): string[] {
    return key.split(/\s+/).filter(t => t.length > 0);
}

/** Tokens that appear back-to-back identically in the given key. */
function adjacentDuplicates(key: string): string[] {
    const ts = tokens(key);
    const dups: string[] = [];
    for (let i = 1; i < ts.length; i++) {
        if (ts[i] === ts[i - 1] && !dups.includes(ts[i])) dups.push(ts[i]);
    }
    return dups;
}

/** True when the duplicated stem looks like a brand (so the row is the
 *  doubled-brand-prefix class). Tries the stem and its plural form since
 *  the brand list stores plural spellings ("oikos") while stored keys carry
 *  the singularized stem ("oiko"). */
function stemLooksLikeBrand(stem: string): boolean {
    return isBrandedIngredient(stem) || isBrandedIngredient(`${stem}s`);
}

function classify(row: { normalizedForm: string }): string | null {
    const raw = row.normalizedForm;
    // Gate on the SHARED predicate — the same isMalformedCacheKey that the
    // read path's legacy-key fallback uses to keep zombie rows dead. The
    // reason strings below are reporting detail on top of it.
    if (!isMalformedCacheKey(raw)) return null;
    const reasons: string[] = [];

    const rawDups = adjacentDuplicates(raw);
    for (const d of rawDups) {
        reasons.push(
            stemLooksLikeBrand(d)
                ? `doubled-brand-prefix "${d}" (adjacent)`
                : `adjacent duplicate token "${d}"`
        );
    }

    // Stem-space check: re-canonicalize (sort + singularize) and look for
    // adjacent duplicates there — catches plural/singular double-brands and
    // legacy unsorted keys whose duplicates aren't literally adjacent.
    const canonical = canonicalizeCacheKey(raw);
    const stemDups = adjacentDuplicates(canonical).filter(d => !rawDups.includes(d));
    for (const d of stemDups) {
        reasons.push(
            stemLooksLikeBrand(d)
                ? `doubled-brand-prefix "${d}" (stem-space)`
                : `duplicate token stem "${d}" (stem-space)`
        );
    }

    // Defensive: canonical collapse changing the key without a dup being
    // named above cannot happen (collapse only removes adjacent dups), but
    // keep the invariant explicit.
    if (reasons.length === 0 && collapseAdjacentDuplicateTokens(canonical) !== canonical) {
        reasons.push('canonical collapse changed key');
    }

    return reasons.length > 0 ? reasons.join('; ') : null;
}

async function main() {
    console.log(`fix-malformed-cache-keys — mode: ${APPLY ? 'APPLY (deleting)' : 'dry-run (report only)'}`);

    const rows = await prisma.foodMapping.findMany({
        select: {
            normalizedForm: true,
            foodName: true,
            offBarcode: true,
            fdcId: true,
            source: true,
            usedCount: true,
            validatedBy: true,
        },
    });
    console.log(`scanned ${rows.length} FoodMapping rows`);

    const findings: Finding[] = [];
    for (const row of rows) {
        const reason = classify(row);
        if (!reason) continue;
        const foodId = row.offBarcode
            ? `off_${row.offBarcode}`
            : row.fdcId != null
                ? `fdc_${row.fdcId}`
                : `${row.source}:${row.foodName}`;
        findings.push({
            normalizedForm: row.normalizedForm,
            foodId,
            foodName: row.foodName,
            usedCount: row.usedCount,
            validatedBy: row.validatedBy,
            reason,
        });
    }

    findings.sort((a, b) => b.usedCount - a.usedCount);

    console.log(`\nmalformed rows: ${findings.length}`);
    for (const f of findings) {
        console.log(
            `  key="${f.normalizedForm}"  foodId=${f.foodId}  usedCount=${f.usedCount}  ` +
            `validatedBy=${f.validatedBy}  food="${f.foodName}"  wrong: ${f.reason}`
        );
    }

    const brandDoubled = findings.filter(f => f.reason.includes('doubled-brand-prefix')).length;
    console.log(`\nsummary: ${findings.length} malformed (${brandDoubled} doubled-brand-prefix, ` +
        `${findings.length - brandDoubled} duplicate-token), ` +
        `${findings.filter(f => f.validatedBy === 'human-triage').length} human-triage`);

    if (!APPLY) {
        console.log('\ndry-run: nothing deleted. Re-run with --apply to delete these rows.');
        return;
    }

    if (findings.length === 0) {
        console.log('nothing to delete.');
        return;
    }

    const { count } = await prisma.foodMapping.deleteMany({
        where: { normalizedForm: { in: findings.map(f => f.normalizedForm) } },
    });
    console.log(`\ndeleted ${count} rows. Next queries re-resolve and re-cache under symmetric keys.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
