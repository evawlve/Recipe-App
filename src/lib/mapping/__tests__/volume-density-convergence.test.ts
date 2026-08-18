import { resolveVolumeGrams, pickVolumeUnits, LARGE_VOLUME_UNIT_SPELLINGS } from '../../units/volume-density';
import {
    OFF_VOLUME_UNIT_SPELLINGS,
    FDC_VOLUME_UNIT_SPELLINGS,
    FDC_MICRO_VOLUME_GRAMS,
} from '../serving/hydration-lane';
import { inferCategoryFromName, categoryDensity, DRY_GRANULE_DENSITY_CATEGORIES } from '../../units/density';

/**
 * Lane B1a — `buildOffResult()` and `buildFdcResult()` stopped carrying their own
 * copies of the volume-density rule and now call the owner
 * (`src/lib/units/volume-density.ts`).
 *
 * WHAT THESE TESTS ARE FOR. A convergence is only trustworthy if someone said,
 * before shipping it, exactly which cells move and which do not. The two
 * `PRE_B1A_*` functions below are VERBATIM transcriptions of the two blocks the
 * change deleted, and every assertion here is a diff against them:
 *
 *   - OFF must be cell-for-cell IDENTICAL on every spelling it accepts. Its
 *     live `volume_unit` events must not move: 8,601 of them have an
 *     `openfoodfacts` winner and 5 have an `fdc` one, all-time (the query
 *     carries no date predicate), measured 2026-08-18. Re-derive:
 *     `SELECT "source", count(*) FROM "MappingEventLog"
 *     WHERE "servingTier"='volume_unit' GROUP BY 1;`
 *     That same query read 8,200 / 0 on 2026-08-17, and this paragraph stated
 *     the 0 as "the FDC arm has never billed a live query". It has. The 5 are
 *     warm (`noCache = false`) and every one carries
 *     `rawLine = 'about 1 cup of egg whites'` — the golden case `n-prose-01`,
 *     i.e. our own eval rather than a user, which is the distinction the
 *     absolute erased. Re-derive:
 *     `SELECT "noCache", "rawLine", count(*) FROM "MappingEventLog"
 *     WHERE "servingTier"='volume_unit' AND "source"='fdc' GROUP BY 1,2;`
 *     Each figure carries its date because the undated one rotted in silence.
 *   - FDC must move on exactly three named classes and nowhere else.
 *
 * A transcription is normally the wrong instrument — it pins the author's
 * snapshot, not the code (the lesson #249 wrote down). It is the right one HERE
 * and only here, because the thing under test is precisely "does the new code
 * reproduce the old code", and the old code no longer exists to be imported.
 * Once a constants PR lands, these become history and should be deleted, not
 * "updated" — updating them would re-pin whatever the new code does.
 *
 * LANE B1b (2026-08-17) LANDED, and it did NOT retire this file: B1b added
 * spellings (`LARGE_VOLUME_UNIT_SPELLINGS` — `l`/`liter(s)`/`litre(s)`, `pint(s)`,
 * `quart(s)`, `gallon(s)`) to both gates and moved no existing cell, so the
 * cell-for-cell identity below still holds on every pre-B1b spelling and is
 * still worth asserting. What B1b FLIPPED (not deleted — the #242 precedent) is
 * the "spelling sets are unchanged" block at the bottom: each lane now accepts
 * exactly its pre-B1a set PLUS the large units, and the pins say so. The large
 * units' own behaviour is pinned in `volume-unit-spellings.test.ts`.
 */

const PRE_B1A_LIQUID_RE = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i;
const PRE_B1A_PASTE_RE =
    /butter|spread|hummus|yogurt|yoghurt|honey|mayo|mayonnaise|jam|jelly|nutella|tahini|cream cheese|sour cream|ricotta|paste|dressing|ketchup|mustard/i;

/** Verbatim: the inline table `buildOffResult()` carried until 2026-08-17. */
function PRE_B1A_OFF_TABLE(candidateName: string): Record<string, number> {
    const isLiquid = PRE_B1A_LIQUID_RE.test(candidateName);
    const isPaste = !isLiquid && PRE_B1A_PASTE_RE.test(candidateName);
    let solidDensity = 0.5;
    const solidCategory = inferCategoryFromName(candidateName);
    if (solidCategory && DRY_GRANULE_DENSITY_CATEGORIES.has(solidCategory)) {
        const d = categoryDensity(solidCategory);
        if (d && d > 0) solidDensity = d;
    }
    const cupG = isLiquid ? 240 : isPaste ? 250 : 240 * solidDensity;
    const tbspG = isLiquid ? 15 : isPaste ? 16 : 15 * solidDensity;
    const tspG = isLiquid ? 5 : isPaste ? 5.3 : 5 * solidDensity;
    return {
        'cup': cupG, 'cups': cupG,
        'tbsp': tbspG, 'tablespoon': tbspG, 'tablespoons': tbspG,
        'tsp': tspG, 'teaspoon': tspG, 'teaspoons': tspG,
        'ml': 1, 'floz': 30, 'fl oz': 30,
        'dash': 0.6, 'dashes': 0.6, 'pinch': 0.3, 'pinches': 0.3,
    };
}

/** Verbatim: the inline table `buildFdcResult()` carried until 2026-08-17. */
function PRE_B1A_FDC_TABLE(candidateName: string, parsedName: string | null): Record<string, number> {
    const isLiquid = PRE_B1A_LIQUID_RE.test(candidateName) || PRE_B1A_LIQUID_RE.test(parsedName || '');
    let densityGml = isLiquid ? 1.0 : 0.5;
    const inferred = inferCategoryFromName(candidateName) || inferCategoryFromName(parsedName || '');
    if (inferred && DRY_GRANULE_DENSITY_CATEGORIES.has(inferred)) {
        const d = categoryDensity(inferred);
        if (d && d > 0) densityGml = d;
    }
    return {
        'cup': 240 * densityGml,
        'tbsp': 15 * densityGml, 'tablespoon': 15 * densityGml, 'tablespoons': 15 * densityGml,
        'tsp': 5 * densityGml, 'teaspoon': 5 * densityGml, 'teaspoons': 5 * densityGml,
        'ml': densityGml, 'floz': 30 * densityGml,
        'dash': 0.6, 'dashes': 0.6, 'pinch': 0.3, 'pinches': 0.3,
        'sprinkle': 0.2, 'shake': 0.2,
        'drop': 0.05, 'drops': 0.05,
        'second': 0.25, 'seconds': 0.25,
    };
}

/** What `buildOffResult()` builds after B1a. */
function offTable(candidateName: string): Record<string, number> {
    return {
        ...pickVolumeUnits(resolveVolumeGrams(candidateName).perUnit, OFF_VOLUME_UNIT_SPELLINGS),
        'ml': 1, 'floz': 30, 'fl oz': 30,
    };
}

/** What `buildFdcResult()` builds after B1a. */
function fdcTable(candidateName: string, parsedName: string | null): Record<string, number> {
    return {
        ...pickVolumeUnits(resolveVolumeGrams(candidateName, parsedName).perUnit, FDC_VOLUME_UNIT_SPELLINGS),
        ...FDC_MICRO_VOLUME_GRAMS,
    };
}

/** One food per volume class, plus the classes the two copies disagreed on. */
const FOODS: Array<[string, string | null]> = [
    ['Chicken Broth', null],            // liquid, no dry-granule category
    ['Maple Syrup', null],              // liquid AND dry-granule category (sugar)
    ['Greek Yogurt', null],             // paste, non-dry category
    ['Peanut Butter', null],            // paste
    ['Honey', null],                    // paste AND dry-granule category
    ['Granulated Sugar', null],         // solid, dry-granule 0.85
    ['All Purpose Flour', null],        // solid, dry-granule 0.53
    ['Rolled Oats', null],              // solid, dry-granule 0.36
    ['White Rice', null],               // solid, category deliberately NOT in the dry set
    ['Table Salt', null],               // solid, uncategorised — the flat 0.5
    ['Swanson Organic', 'chicken broth'], // classifying token ONLY in the query name
    ['Whole Milk', 'milk'],
];

/** The key set a lane accepts after B1b: its pre-B1a set plus the large units. */
function withLargeUnits(preB1aKeys: string[]): string[] {
    return [...preB1aKeys, ...LARGE_VOLUME_UNIT_SPELLINGS].sort();
}

describe('B1a — buildOffResult is a pure de-duplication (zero cells move)', () => {
    it.each(FOODS.map(([c]) => c))('%s: every pre-B1b spelling is byte-identical to the deleted copy', (name) => {
        const before = PRE_B1A_OFF_TABLE(name);
        const after = offTable(name);
        // B1b added the large units and nothing else (flipped from strict equality).
        expect(Object.keys(after).sort()).toEqual(withLargeUnits(Object.keys(before)));
        for (const spelling of Object.keys(before)) {
            expect(`${spelling}=${after[spelling]}`).toBe(`${spelling}=${before[spelling]}`);
        }
    });

    it('the pinned ml/floz values are NOT the owner\'s, and that is the open item', () => {
        // The one family where this lane and the owner still disagree. The owner
        // scales by density; the lane bills flat. Converging is a CONSTANT change
        // with its own gate — and it is not free: `250 ml red bull` (the only
        // ml/floz traffic in the live `volume_unit` population, 2 of 8,200,
        // measured 2026-08-17) would go 250 g -> 125 g, because LIQUID_RE misses
        // energy drinks. When that PR lands, delete this test with the pin.
        const owner = resolveVolumeGrams('Red Bull');
        expect(owner.volumeClass).toBe('solid');
        expect(owner.perUnit['ml']).toBe(0.5);
        expect(offTable('Red Bull')['ml']).toBe(1);
    });
});

describe('B1a — buildFdcResult moves on exactly three named classes', () => {
    it('(1) the paste tier now applies: 1 tbsp peanut butter 7.5 g -> 16 g', () => {
        expect(PRE_B1A_FDC_TABLE('Peanut Butter', null)['tbsp']).toBe(7.5);
        expect(fdcTable('Peanut Butter', null)['tbsp']).toBe(16);
        expect(fdcTable('Greek Yogurt', null)['cup']).toBe(250);   // was 120
    });

    it('(2) the dry-granule override no longer stomps the liquid default', () => {
        // The deleted copy applied the category density unconditionally, so a
        // food that is liquid AND categorised dry-granular billed the granule
        // number. The owner's liquid branch is inviolate.
        expect(PRE_B1A_FDC_TABLE('Maple Syrup', null)['cup']).toBe(204);
        expect(fdcTable('Maple Syrup', null)['cup']).toBe(240);
        expect(resolveVolumeGrams('Maple Syrup').volumeClass).toBe('liquid');
    });

    it('(3) the QUERY name no longer classifies the food', () => {
        // Deleted copy: RE.test(candidate.name) || RE.test(parsed.name). Owner:
        // the FIRST NON-EMPTY name, which is the matched record's. This NARROWS,
        // and widening the owner is a separate change with its own gate — see the
        // KNOWN DIVERGENCE note on resolveVolumeGrams().
        expect(PRE_B1A_FDC_TABLE('Swanson Organic', 'chicken broth')['cup']).toBe(240);
        expect(fdcTable('Swanson Organic', 'chicken broth')['cup']).toBe(120);
    });

    it('nothing else moves: every non-paste, non-liquid-with-category food is identical', () => {
        for (const name of ['Granulated Sugar', 'All Purpose Flour', 'Rolled Oats', 'White Rice', 'Table Salt', 'Chicken Broth', 'Whole Milk']) {
            const before = PRE_B1A_FDC_TABLE(name, null);
            const after = fdcTable(name, null);
            for (const spelling of Object.keys(before)) {
                expect(`${name} ${spelling}=${after[spelling]}`).toBe(`${name} ${spelling}=${before[spelling]}`);
            }
        }
    });
});

describe('the unit SPELLING sets are the branch gate — B1a left them alone, B1b added exactly the large units', () => {
    // `unit && volumeToGrams[unit]` decides whether a line enters the volume
    // branch at all. On FDC that branch also holds the three LIVE rungs
    // (fdc_label_volume 2,134 / fdc_volume_cached 632 / fdc_volume_ai 318,
    // measured 2026-08-17), so a spelling added here moves real traffic. B1a
    // pinned each set to what its lane accepted before the convergence; B1b
    // (2026-08-17) FLIPPED both pins to "that set plus LARGE_VOLUME_UNIT_SPELLINGS"
    // — the eleven spellings that used to fall through every branch to a flat
    // 100 g. Anything else appearing here is an unreviewed gate change.
    it('OFF accepts exactly what it accepted before, plus the large units', () => {
        expect(Object.keys(offTable('Table Salt')).sort())
            .toEqual(withLargeUnits(Object.keys(PRE_B1A_OFF_TABLE('Table Salt'))));
    });

    it('FDC accepts exactly what it accepted before, plus the large units', () => {
        expect(Object.keys(fdcTable('Table Salt', null)).sort())
            .toEqual(withLargeUnits(Object.keys(PRE_B1A_FDC_TABLE('Table Salt', null))));
    });

    it('the owner carries spellings NEITHER lane admits — B1b admitted only the large units', () => {
        const ownerKeys = Object.keys(resolveVolumeGrams('Table Salt').perUnit);
        expect(ownerKeys).toContain('milliliter');
        expect(ownerKeys).toContain('milliliters');
        expect(offTable('Table Salt')['milliliter']).toBeUndefined();
        // FDC additionally never accepted `cups` or `fl oz`, both of which the
        // owner carries. Reachable via mapIngredientWithFallback's
        // aiParseIngredient() fallback, which assigns the model's raw string.
        expect(fdcTable('Table Salt', null)['cups']).toBeUndefined();
        expect(fdcTable('Table Salt', null)['fl oz']).toBeUndefined();
    });

    it('FDC keeps its spray/drop micro-measures, which the owner has no value for', () => {
        const t = fdcTable('Olive Oil', null);
        expect(t['sprinkle']).toBe(0.2);
        expect(t['shake']).toBe(0.2);
        expect(t['drop']).toBe(0.05);
        expect(t['second']).toBe(0.25);
        expect(resolveVolumeGrams('Olive Oil').perUnit['drop']).toBeUndefined();
    });
});

describe('pickVolumeUnits', () => {
    it('restricts to the accepted spellings and drops the rest', () => {
        const perUnit = resolveVolumeGrams('Peanut Butter').perUnit;
        expect(pickVolumeUnits(perUnit, ['tbsp', 'cup'])).toEqual({ tbsp: 16, cup: 250 });
    });

    it('drops a spelling the owner has no value for rather than writing undefined', () => {
        const picked = pickVolumeUnits(resolveVolumeGrams('Salt').perUnit, ['tsp', 'drop']);
        expect(Object.keys(picked)).toEqual(['tsp']);
        expect('drop' in picked).toBe(false);
    });
});
