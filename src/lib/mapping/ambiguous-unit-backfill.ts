/**
 * Ambiguous Unit Backfill
 * 
 * Handles backfill for ambiguous units (container, scoop, bowl, etc.)
 * that require AI estimation to determine weight.
 * 
 * Saves to fdcServing, offServing, or aiGeneratedServing.
 * Uses simpler AI prompt focused on package/portion size estimation.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { isWriteSuppressed, noteRefusedWrite } from '../write-policy';
import {
    isAmbiguousUnit,
    isEstimableUnknownUnit,
    estimateAmbiguousServing,
    getAmbiguousUnitBounds,
    packetMaxGrams,
    AMBIGUOUS_UNITS,
} from '../ai/ambiguous-serving-estimator';

export { isAmbiguousUnit, AMBIGUOUS_UNITS };

export interface AmbiguousBackfillResult {
    status: 'success' | 'cached' | 'error';
    grams?: number;
    confidence?: number;
    error?: string;
}

/**
 * Does this food id have a serving table of its own?
 *
 * `fdc_`/`fdc:` → `FdcServing`, `off_` → `OffServing`, anything else →
 * `AiGeneratedServing`. That trailing "anything else" is the defect: an `fs_`
 * id lands there, and `AiGeneratedServing.foodId` is a foreign key to
 * `AiGeneratedFood.id` (`awk '/^model AiGeneratedServing/,/^}/' prisma/schema.prisma`)
 * where no `fs_` row exists — `SELECT count(*) FROM "AiGeneratedFood" WHERE id
 * LIKE 'fs_%'` → **0** (measured 2026-08-05, box). So FatSecret has no serving
 * write target at all, and this predicate is the single place that says so.
 *
 * `false` means "no table", NOT "failed". Its two callers therefore differ:
 *
 *   - `upsertServing()` skips the write and returns `false`. A genuine write
 *     failure still THROWS, so every caller must keep its `try`/`catch` warn.
 *   - `findExistingServing()` returns `null` without a query. That is not a
 *     behaviour change, it removes a guaranteed miss: the same foreign key that
 *     rejects the write makes an `fs_` row impossible to *read* —
 *     `SELECT count(*) FILTER (WHERE "foodId" LIKE 'fs_%'), count(*) FROM
 *     "AiGeneratedServing"` → **0 of 608** (measured 2026-08-05, box). The read
 *     never threw and never returned a row; it was one wasted round trip per
 *     `fs_` ambiguous line. Keeping the two sides symmetric is the point — an
 *     asymmetric guard invites "the read works, so the write must be fine".
 *
 * DO NOT resolve this by giving `fs_` a write target. Both obvious ways are
 * refuted with measurements in
 * `sync-docs/reports/2026-08-05_serving-fix-build-order.md` §1:
 *   - **DNB-1**, writing `FatSecretServing`: that table has none of
 *     `source`/`isAiEstimated`/`confidence`/`note`, so an AI estimate becomes
 *     indistinguishable from a licensed label serving under the FatSecret Web
 *     Badge (CLAUDE.md §Attribution is a legal boundary); and
 *     `fsHasServingShape()` in `validated-mapping-helpers.ts` is a
 *     `findFirst({ fsId, grams: { gt: 0 } })` with no provenance filter, so a
 *     synthetic row flips a record SHAPELESS→SHAPED at the save gate. That
 *     blast radius is **5**: of the 61 `fs_` foods in the failure log, 6 have no
 *     `FatSecretServing` row with `grams > 0`, and 5 of those 6 have a
 *     `FatSecretFood` parent so the write would land — the sixth,
 *     `fs_86607832`, has no parent and would still throw (measured 2026-08-05,
 *     re-derive with the query in the report's §1). It is **not** 3,472; that is
 *     the corpus-wide item-#16 ceiling, a different population.
 *   - **DNB-2**, seeding an `AiGeneratedFood` shell keyed by an `fs_` id:
 *     fabricates a 0-kcal food that `searchFatSecretCacheFoods()` returns as a
 *     selectable search result.
 */
function hasServingWriteTarget(foodId: string): boolean {
    return !foodId.startsWith('fs_');
}

/**
 * Which table `upsertServing()` would route this id to. Reporting only — it names the
 * table on a write-suppression receipt so "no row landed" says WHERE no row landed.
 * Mirrors the branch order in `upsertServing()` below; if that order ever changes, this
 * goes with it.
 */
function servingTableFor(foodId: string): string {
    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) return 'FdcServing';
    if (foodId.startsWith('off_')) return 'OffServing';
    return 'AiGeneratedServing';
}

async function findExistingServing(foodId: string, normalizedUnit: string) {
    // Symmetric with upsertServing(): no write target ⇒ no readable row either.
    if (!hasServingWriteTarget(foodId)) return null;

    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) {
        const id = foodId.startsWith('fdc:') ? parseInt(foodId.split(':')[1], 10) : parseInt(foodId.split('_')[1], 10);
        const s = await prisma.fdcServing.findUnique({
            where: {
                FdcServing_fdcId_description_key: { fdcId: id, description: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    } else if (foodId.startsWith('off_')) {
        const barcode = foodId.replace('off_', '');
        const s = await prisma.offServing.findUnique({
            where: {
                barcode_description: { barcode, description: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    } else {
        const s = await prisma.aiGeneratedServing.findUnique({
            where: {
                foodId_label: { foodId, label: normalizedUnit }
            }
        });
        return s ? { grams: s.grams } : null;
    }
}

/**
 * Persist an ambiguous-unit estimate into the per-source serving table.
 *
 * Returns `true` when a row was written and `false` when `hasServingWriteTarget()`
 * says this id has nowhere to go. **`false` is not "failed"** — a genuine write
 * failure still THROWS, so every caller keeps its `try`/`catch` warn.
 *
 * WHY THE SKIP IS A `warn` AND MUST STAY ONE.
 * The box has no `LOG_LEVEL` line in its `.env` (re-derive:
 * `ssh owner@192.168.1.133 'cd /home/owner/Recipe-App && grep -c "^LOG_LEVEL" .env'`
 * → **0**, measured 2026-08-05), and `resolveThreshold()` in `src/lib/logger.ts`
 * defaults production to `warn`. A `logger.debug` here would therefore be
 * INVISIBLE on the only machine that has this population — the guard would fire
 * hundreds of times with nothing to show for it. This warn is also
 * volume-neutral: it fires on exactly the lines that used to emit
 * `ambiguous_backfill.save_failed` from the caller's catch, so the box's warn
 * count does not move. If you ever want it quieter, move the *population* count
 * somewhere else first (a counter on `/api/ok`, per B4) — do not just lower the
 * level.
 *
 * THE POPULATION IT REPLACES (all measured 2026-08-05; `next-start.log` is
 * append-only and still growing, so these are a snapshot — quote the date, and
 * prefer the two stable quantities, 61 foods / 167 food+unit pairs):
 *   - **338** `ambiguous_backfill.save_failed` lines box-wide
 *     (`ssh owner@192.168.1.133 'grep -c ambiguous_backfill.save_failed
 *     /home/owner/Recipe-App/logs/*.log /home/owner/Recipe-App/*.log'`), of which
 *     **282** are in `logs/next-start.log` and **311** across `logs/*.log`.
 *   - **311 are `fs_`**, over **61 distinct foods** and **167 food+unit pairs**
 *     (`… | grep -c '"foodId":"fs_"'`, and pipe through
 *     `grep -o '"foodId":"fs_[0-9]*","unit":"[^"]*"' | sort -u | wc -l`).
 *   - **27 are not** — all `fdc_`, all 2026-03-31, all raised by
 *     `prisma.fatSecretServingCache.upsert()` from `src/lib/fatsecret/` (a module
 *     path and a table that no longer exist), and they sit one directory up in
 *     `batch-import-results.log`, not under `logs/`. So they are evidence that
 *     this catch HAS had a real non-`fs_` class, NOT a measurement of its current
 *     rate — that rate is unmeasured, which is not the same as zero. Keep the
 *     catch: `FdcServing.fdcId` and `OffServing.barcode` are foreign keys too
 *     (`prisma/schema.prisma`), so the `fdc_`/`off_` branches below can still
 *     reject, and this warn is the only witness.
 *
 * THIS SHORT-CIRCUIT MOVES NO GRAMS. The estimate is still computed and still
 * returned; only persistence is lost, exactly as before — the FK was already
 * rejecting every one of these writes. Nor does it recover the redundant AI
 * spend: with persistence broken, 311 estimates covered 167 distinct pairs, so
 * **144 were recomputations** ⇒ 144 × $0.102/1,000 calls = **~$0.0147, DERIVED
 * and an UPPER BOUND** (`estimateAmbiguousServing()` can return `status:'success'`
 * from its non-LLM `getFdcServingWeight()` rung, so a `save_failed` line does not
 * prove a model ran; price from `reports/2026-08-05_ai-serving-spend-audit.md`).
 * Recovering that needs a write target, which is DNB-1/DNB-2 — refuted. B3 buys
 * observability and an end to the FK noise, not money.
 */
async function upsertServing(
    foodId: string,
    normalizedUnit: string,
    grams: number,
    confidence: number,
    note?: string,
    source: string = 'ai',
    isAiEstimated: boolean = true,
    saveBand?: { foodName: string },
): Promise<boolean> {
    if (!hasServingWriteTarget(foodId)) {
        logger.warn('ambiguous_backfill.persist_skipped_no_target', {
            foodId,
            unit: normalizedUnit,
            grams,
        });
        return false;
    }

    // REQUEST-SCOPED WRITE SUPPRESSION (nosave=1). `false` here means what it has always
    // meant on this function — "not persisted", NOT "failed" — so every caller is
    // unchanged: `getOrCreateAmbiguousServing()` returns the computed grams either way
    // and `ambiguous_backfill.saved` is already conditional on `persisted`. Zero caller
    // edits across the seven call sites. Placed after the write-target guard so the two
    // reasons a row does not land stay distinguishable in the logs and on the receipt.
    if (isWriteSuppressed('aiServing')) {
        noteRefusedWrite('aiServing', servingTableFor(foodId), `${foodId}:${normalizedUnit}`);
        return false;
    }

    // THE SAVE BAND (s461 WHOLE-PERSIST): a model estimate outside it is still returned to
    // the caller, which bills or refuses it for this request, but it is never written. After
    // the two guards above, so a nosave receipt and the `consulted` counter read as before.
    if (saveBand) {
        const refusal = persistBandRefusal(normalizedUnit, grams, saveBand.foodName,
            await recordPackageGrams(foodId));
        if (refusal) {
            logger.warn('ambiguous_backfill.persist_out_of_band', {
                foodId, foodName: saveBand.foodName, unit: normalizedUnit, grams, refusal,
            });
            return false;
        }
    }

    if (foodId.startsWith('fdc_') || foodId.startsWith('fdc:')) {
        const id = foodId.startsWith('fdc:') ? parseInt(foodId.split(':')[1], 10) : parseInt(foodId.split('_')[1], 10);
        await prisma.fdcServing.upsert({
            where: {
                FdcServing_fdcId_description_key: { fdcId: id, description: normalizedUnit }
            },
            create: {
                fdcId: id,
                description: normalizedUnit,
                grams,
                source,
                isAiEstimated
            },
            update: {
                grams,
                source,
                isAiEstimated
            }
        });
    } else if (foodId.startsWith('off_')) {
        const barcode = foodId.replace('off_', '');
        await prisma.offServing.upsert({
            where: {
                barcode_description: { barcode, description: normalizedUnit }
            },
            create: {
                barcode,
                description: normalizedUnit,
                grams,
                source,
                isAiEstimated
            },
            update: {
                grams,
                source,
                isAiEstimated
            }
        });
    } else {
        await prisma.aiGeneratedServing.upsert({
            where: {
                foodId_label: { foodId, label: normalizedUnit }
            },
            create: {
                foodId,
                label: normalizedUnit,
                grams,
                aiConfidence: confidence,
                aiNotes: note
            },
            update: {
                grams,
                aiConfidence: confidence,
                aiNotes: note
            }
        });
    }
    return true;
}

/**
 * THE SAVE BAND FOR A MODEL-ESTIMATED SERVING (s461 WHOLE-PERSIST).
 *
 * getOrCreateAmbiguousServing() writes the model's answer before any caller reads it, and a
 * saved row answers every later request for that (record, unit) ahead of the model, so the
 * first draw is the record's answer for good. Most units carry no bounds at all: 52 of
 * AMBIGUOUS_UNITS' 80 spellings have no getAmbiguousUnitBounds() entry (`whole`, `small`,
 * `medium`, `large`, `container`, `slice`, `each`, ...). This band decides only
 * whether the answer is WRITTEN. The caller still gets it and bills or refuses it for this
 * request (the band never moves this request's bill; the next request asks the model again).
 * Three clauses, each a property of the unit or the record, never of the line:
 *   1. `unit_bounds`: the unit's own read bounds. A row findExistingServing()'s caller would
 *      reject on read is never written. The estimator clamps its model answer to these, so
 *      today this catches only an unclamped rung (getFdcServingWeight()).
 *   2. `whole_max`: a `whole` above WHOLE_SAVE_MAX_GRAMS (2,000 g) is a roast, a holiday bird
 *      or a tub, not one item a person logs (prod: `Roast Turkey` whole = 3,000 g; s461
 *      replays: `Turkey` 4,000 / 4,500, `Smoked Turkey` 2,400 / 3,000, `Turkey dinner`
 *      3,500, a 2,270 g gainer tub). Same number as the fraction rule's bill cap.
 *   3. `over_package`: one unit of a product cannot outweigh the product's own net package
 *      (OFF `packageQuantity` in g or ml, ml read as grams; PACKAGE_SAVE_TOLERANCE 1.1 covers
 *      label rounding and a drink's density), floored at the record's own `servingGrams`: a
 *      package lighter than one serving of itself is a mis-read `product_quantity` (prod:
 *      noosa mango 0.5 g on a 113 g cup, Parmalat milk 1 g on a 250 ml serving, Orgain powder
 *      21 g on a 46 g serving; s461 rf-persist-b). Prod holds 18 such OFF rows (s461 pd-persist), e.g.
 *      `Roasted Chicken` (709 g pack) whole = 1,200 g, `Hunt's Ketchup` (397 g) large = 450 g,
 *      `Whataburger Onion Rings` (136 g) large = 310 g; a replay drew `Smoked Turkey` (170 g)
 *      whole = 2,400 g. OFF only: FDC and AiGenerated records carry no package.
 * A lookup that fails reads as "no package" (clause 3 skipped, today's behaviour).
 * Measured cost (s461 pd-persist, 552 records with a `whole` draw): clause 2 refuses 0 and
 * clause 3 refuses 2 of 111 first draws graded GOOD against a written truth band. The request
 * that drew a refused answer bills exactly what it bills today. The NEXT request for that
 * (record, unit) asks the model again (~2 s) and, the model being unseeded, may bill a
 * different weight, until an in-band answer is drawn and saved (s461 rf-persist-b).
 * The sibling borrow (genuine same-brand label medians) does not pass a band.
 */
export const WHOLE_SAVE_MAX_GRAMS = 2000;
export const PACKAGE_SAVE_TOLERANCE = 1.1;

export type PersistBandRefusal = 'unit_bounds' | 'whole_max' | 'over_package';

/** Which clause of the save band an estimate breaks, or null when it may be written. Pure. */
export function persistBandRefusal(
    unit: string,
    grams: number,
    foodName: string | null | undefined,
    packageGrams: number | null | undefined,
): PersistBandRefusal | null {
    const u = unit.toLowerCase().trim();
    const bounds = getAmbiguousUnitBounds(u, foodName);
    if ((bounds.min != null && grams < bounds.min) || (bounds.max != null && grams > bounds.max)) return 'unit_bounds';
    if (u === 'whole' && grams > WHOLE_SAVE_MAX_GRAMS) return 'whole_max';
    if (packageGrams != null && packageGrams > 0 && grams > PACKAGE_SAVE_TOLERANCE * packageGrams) return 'over_package';
    return null;
}

/**
 * The OFF record's own net package in grams (`g`, or `ml` read as grams), floored at its own
 * label `servingGrams` (a package cannot weigh less than one serving of itself), else null.
 * Never throws.
 */
async function recordPackageGrams(foodId: string): Promise<number | null> {
    if (!foodId.startsWith('off_')) return null;
    try {
        const food = await prisma.offFood.findUnique({
            where: { barcode: foodId.replace('off_', '') },
            select: { packageQuantity: true, packageQuantityUnit: true, servingGrams: true },
        });
        const q = food?.packageQuantity;
        const u = food?.packageQuantityUnit?.toLowerCase().trim();
        if (q == null || !(q > 0) || (u !== 'g' && u !== 'ml')) return null;
        const s = food?.servingGrams;
        return s != null && s > q ? s : q;
    } catch {
        return null;
    }
}

// ============================================================
// Sibling-serving borrow
// ============================================================

function siblingSingularize(w: string): string {
    const s = w.toLowerCase();
    if (s.endsWith('ies')) return s.slice(0, -3) + 'y';
    if (s.endsWith('sses')) return s.slice(0, -2);
    if (s.endsWith('s') && !s.endsWith('ss')) return s.slice(0, -1);
    return s;
}

function siblingLeadingCount(description: string): number {
    const m = description.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return 1;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

function median(nums: number[]): number {
    const sorted = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Confidence scales with the number of sibling samples backing the borrow. */
function siblingConfidence(sampleCount: number): number {
    return Math.min(0.6 + 0.1 * sampleCount, 0.95);
}

/**
 * Before AI-estimating an ambiguous serving, look for a GENUINE (label-derived)
 * serving of the same unit on another product from the SAME brand. Within a
 * brand's product line a "bar" or "scoop" is near-constant, so this resolves
 * the weight deterministically from real label data. OFF-only for v1.
 *
 * The requested unit self-segments the product line: only bar SKUs carry a
 * "bar" serving and only powders carry a "scoop", so brand + unit isolates the
 * right sub-line without name-token clustering.
 */
async function borrowSiblingServing(
    foodId: string,
    brandName: string | null | undefined,
    normalizedUnit: string,
): Promise<{ grams: number; sampleCount: number } | null> {
    if (!foodId.startsWith('off_')) return null;          // OFF-only (v1)
    const brand = brandName?.trim();
    if (!brand || brand.length < 2) return null;          // no brand → no product line
    const unitStem = siblingSingularize(normalizedUnit).replace(/[^a-z]/g, '');
    if (!unitStem) return null;
    const selfBarcode = foodId.replace('off_', '');

    // Genuine servings only (isAiEstimated=false AND source='openfoodfacts') so
    // borrowed rows (source='sibling_borrow') never seed further borrows — that
    // exclusion is what prevents transitive estimate drift.
    let rows: Array<{ grams: number; description: string }>;
    try {
        rows = await prisma.$queryRaw<Array<{ grams: number; description: string }>>`
            SELECT s.grams, s.description
            FROM "OffServing" s
            JOIN "OffFood" f ON s.barcode = f.barcode
            WHERE lower(f."brandName") = ${brand.toLowerCase()}
              AND s."isAiEstimated" = false
              AND s.source = 'openfoodfacts'
              AND s.barcode <> ${selfBarcode}
              AND s.description ~* ${'\\m' + unitStem + 's?\\M'}
            LIMIT 50
        `;
    } catch (e) {
        logger.warn('ambiguous_backfill.sibling_query_failed', {
            foodId, unit: normalizedUnit, error: (e as Error).message,
        });
        return null;
    }
    if (!rows.length) return null;

    // Per-unit grams = serving grams / leading count ("2 scoops (46g)" → 23g).
    const perUnit: number[] = [];
    for (const r of rows) {
        const count = siblingLeadingCount(r.description);
        const g = r.grams / (count > 0 ? count : 1);
        if (g >= 0.2 && g <= 600) perUnit.push(g);
    }
    if (!perUnit.length) return null;

    // Median, then drop values outside [0.5x, 2x] of it and re-median — robust
    // to a few mislabeled sibling SKUs.
    const m0 = median(perUnit);
    const keep = perUnit.filter(g => g >= 0.5 * m0 && g <= 2 * m0);
    if (!keep.length) return null;
    return { grams: median(keep), sampleCount: keep.length };
}

/**
 * Get or create an ambiguous serving.
 */
export async function getOrCreateAmbiguousServing(
    foodId: string,
    foodName: string,
    unit: string,
    brandName?: string | null
): Promise<AmbiguousBackfillResult> {
    const normalizedUnit = unit.toLowerCase().trim();

    try {
        const { getSubPieceDefault } = await import('../servings/default-count-grams');
        const cleanFoodName = foodName.replace(/\b(chunks?|pieces?|slices?|bites?|wedges?|strips?|segments?)\b/gi, '').trim();
        const subPieceResult = getSubPieceDefault(cleanFoodName, normalizedUnit);
        if (subPieceResult) {
            logger.debug('ambiguous_backfill.sub_piece_deterministic', {
                foodId,
                unit: normalizedUnit,
                grams: subPieceResult.grams,
            });
            return {
                status: 'success',
                grams: subPieceResult.grams,
                confidence: subPieceResult.confidence,
            };
        }
    } catch (e) {
        // Ignore
    }

    try {
        const { getDefaultCountServing } = await import('../servings/default-count-grams');
        const sizeFromUnit = normalizedUnit as 'small' | 'medium' | 'large';
        const isSize = ['small', 'medium', 'large'].includes(sizeFromUnit);
        const countDefault = getDefaultCountServing(
            foodName,
            normalizedUnit,
            isSize ? sizeFromUnit : undefined
        );
        // Unit-bounds sanity (count-noun sibling routing, Track 3 Jul 2026):
        // the seed lookup falls back to FOOD-NAME word matching, so a "bar"
        // request on "… Caramel Cashew" can surface the 1.5g cashew seed —
        // a per-piece weight in disguise for the requested unit. Out-of-bounds
        // seeds fall through to sibling-borrow / AI instead.
        if (countDefault) {
            // A word-matched seed is a PIECE weight (nugget 18 g, wing 34 g, cookie 30 g, strawberry 12 g),
            // never a packet: the food packet caps (packetMaxGrams) admit model answers and cached rows,
            // so a packet line on a food name keeps the condiment bound here and a piece seed above it
            // falls through to sibling-borrow / AI (s461 PKT-FOOD; rf-pktfood measured 152 names).
            const seedBounds = getAmbiguousUnitBounds(
                normalizedUnit, packetMaxGrams(normalizedUnit, foodName) != null ? null : foodName);
            const seedOutOfBounds = (seedBounds.min != null && countDefault.grams < seedBounds.min)
                || (seedBounds.max != null && countDefault.grams > seedBounds.max);
            if (seedOutOfBounds) {
                logger.warn('ambiguous_backfill.count_default_out_of_bounds', {
                    foodId,
                    unit: normalizedUnit,
                    grams: countDefault.grams,
                    bounds: seedBounds,
                });
            } else {
                logger.debug('ambiguous_backfill.count_deterministic', {
                    foodId,
                    unit: normalizedUnit,
                    grams: countDefault.grams,
                });
                return {
                    status: 'success',
                    grams: countDefault.grams,
                    confidence: countDefault.confidence,
                };
            }
        }
    } catch (e) {
        // Ignore
    }

    // Accept both the curated ambiguous set AND estimable unknown units (e.g.
    // "bar", "cookie") — discrete packaged items need a weight estimate too, and
    // sibling-borrow below can often resolve them deterministically from a
    // same-brand product's genuine label serving.
    if (!isAmbiguousUnit(normalizedUnit) && !isEstimableUnknownUnit(normalizedUnit)) {
        return { status: 'error', error: `"${unit}" is not an estimable unit` };
    }

    // Check existing — but reject cached servings outside the unit's sanity
    // bounds (a poisoned "handful" row of 1.2g is a per-piece weight in
    // disguise; fall through so the estimator overwrites it).
    const existing = await findExistingServing(foodId, normalizedUnit);
    if (existing?.grams) {
        const bounds = getAmbiguousUnitBounds(normalizedUnit, foodName);
        const outOfBounds = (bounds.min != null && existing.grams < bounds.min)
            || (bounds.max != null && existing.grams > bounds.max);
        if (outOfBounds) {
            logger.warn('ambiguous_backfill.cached_out_of_bounds', {
                foodId,
                unit: normalizedUnit,
                grams: existing.grams,
                bounds,
            });
        } else {
            logger.debug('ambiguous_backfill.cache_hit', {
                foodId,
                unit: normalizedUnit,
                grams: existing.grams,
            });
            return {
                status: 'cached',
                grams: existing.grams,
            };
        }
    }

    // Sibling-serving borrow: before paying for an AI estimate, try to borrow a
    // genuine label serving of this unit from another same-brand product.
    const sibling = await borrowSiblingServing(foodId, brandName, normalizedUnit);
    if (sibling) {
        const confidence = siblingConfidence(sibling.sampleCount);
        // `persisted` is structurally `true` here today — borrowSiblingServing()
        // returns null for anything that is not `off_`, so this call site can
        // only ever hand upsertServing() an id that HAS a write target. It is
        // captured and logged anyway: this is the sibling of the save site
        // below, and discarding the boolean is exactly how that site would come
        // to log a save that never happened. If `persisted:false` ever appears
        // on this event, borrowSiblingServing()'s OFF-only guard has been
        // widened without widening upsertServing()'s targets.
        let persisted = false;
        try {
            persisted = await upsertServing(
                foodId, normalizedUnit, sibling.grams, confidence,
                `sibling-borrowed from ${sibling.sampleCount} ${brandName ?? 'brand'} product(s)`,
                'sibling_borrow', false,
            );
        } catch (error) {
            logger.warn('ambiguous_backfill.sibling_save_failed', {
                foodId, unit: normalizedUnit, error: (error as Error).message,
            });
        }
        // The borrow itself always logs — it is the decision that moved the
        // grams, and it happened whether or not the row was written. Only the
        // persistence claim is conditional.
        logger.info('ambiguous_backfill.sibling_borrow', {
            foodId, foodName, unit: normalizedUnit,
            grams: sibling.grams, samples: sibling.sampleCount,
            persisted,
        });
        return { status: 'success', grams: sibling.grams, confidence };
    }

    // Call AI
    logger.info('ambiguous_backfill.estimating', { foodId, foodName, unit: normalizedUnit });

    const result = await estimateAmbiguousServing({
        foodName,
        brandName,
        unit: normalizedUnit,
    });

    if (result.status !== 'success' || !result.estimatedGrams) {
        logger.warn('ambiguous_backfill.ai_failed', {
            foodId,
            foodName,
            unit: normalizedUnit,
            error: result.error,
        });
        return { status: 'error', error: result.error ?? 'AI estimation failed' };
    }

    // Save. `saved` is logged ONLY when a row was actually written — an id with
    // no write target returns false and is not a save. The catch below stays:
    // a genuine `fdc_`/`off_` write failure must remain loud.
    try {
        const persisted = await upsertServing(foodId, normalizedUnit, result.estimatedGrams, result.confidence ?? 1, result.reasoning?.slice(0, 200), 'ai', true, { foodName });

        if (persisted) {
            logger.info('ambiguous_backfill.saved', {
                foodId,
                foodName,
                unit: normalizedUnit,
                grams: result.estimatedGrams,
                confidence: result.confidence,
            });
        }
    } catch (error) {
        logger.warn('ambiguous_backfill.save_failed', {
            foodId,
            unit: normalizedUnit,
            error: (error as Error).message,
        });
    }

    return {
        status: 'success',
        grams: result.estimatedGrams,
        confidence: result.confidence,
    };
}

/**
 * Check for user-specific portion override first, then fall back to global.
 */
export async function getUserOrGlobalPortionOverride(
    userId: string | null | undefined,
    foodId: string,
    unit: string
): Promise<{ grams: number; source: 'user' | 'global' } | null> {
    const normalizedUnit = unit.toLowerCase().trim();

    if (userId) {
        const userOverride = await prisma.userPortionOverride.findUnique({
            where: {
                userId_foodId_unit: { userId, foodId, unit: normalizedUnit },
            },
        });

        if (userOverride) {
            return { grams: userOverride.grams, source: 'user' };
        }
    }

    // 2. Check global / cached estimates
    const existing = await findExistingServing(foodId, normalizedUnit);
    if (existing?.grams) {
        return { grams: existing.grams, source: 'global' };
    }

    return null;
}
