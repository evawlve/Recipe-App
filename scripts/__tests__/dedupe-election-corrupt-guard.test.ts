import { isBetterRepresentative, completenessScore } from '../dedupe-off-mark';
import type { Row } from '../dedupe-off-mark';

/**
 * Near-dup election must never elect a corrupt-marked row over a clean one.
 *
 * The hazard is not that marks get lost — they are sticky. It is that
 * `dedupe-off-mark --clear` resets every `duplicateOfBarcode` and re-elects
 * from scratch, and before this change the election could not see
 * `corruptReason` at all: the field was absent from both the `Row` type and the
 * Prisma `select`. So the guard had no input, silently.
 *
 * Why completeness cannot be trusted to break the tie in our favour: the
 * corrupt row is usually the MORE complete of the pair. The defect in this
 * corpus is a whole-container panel stored as per-100g, which means every macro
 * is populated (just at the wrong scale) and `servingGrams` is set — a perfect
 * 5/5 on `completenessScore`. Its clean twin routinely scores lower. That is
 * why the corrupt check has to come FIRST, and it is what the tests below pin.
 *
 * Real pair this was found on: `7500024202430` / `7500024202434`, Factor
 * "Sun dried tomato chicken", byte-identical inflated panels (312 g, 670 kcal,
 * macro sum 102 g/100g — arithmetically impossible).
 */

function row(over: Partial<Row> & Pick<Row, 'barcode' | 'name'>): Row {
    return {
        brandName: null,
        nutrientsPer100g: null,
        servingGrams: null,
        servingSize: null,
        corruptReason: null,
        ...over,
    };
}

/** The shape the defect actually takes: every macro filled, serving set. */
const FULL_PANEL = { calories: 670, protein: 39, carbs: 14, fat: 49 };

describe('a clean row always beats a corrupt one', () => {
    it('prefers the clean row even when the corrupt row is strictly MORE complete', () => {
        // This is the non-obvious case and the whole reason for the ordering.
        const corrupt = row({
            barcode: '7500024202430',
            name: 'Sun dried tomato chicken',
            nutrientsPer100g: FULL_PANEL,
            servingGrams: 312,
            corruptReason: 'macro-sum-impossible:direct',
        });
        const clean = row({
            barcode: '7500024202434',
            name: 'Sun dried tomato chicken',
            nutrientsPer100g: { calories: 140 }, // sparse but honest
        });

        // Guard against the test being vacuous: the corrupt row really is the
        // more complete one, so completeness alone would elect it.
        expect(completenessScore(corrupt)).toBeGreaterThan(completenessScore(clean));

        expect(isBetterRepresentative(clean, corrupt)).toBe(true);
        expect(isBetterRepresentative(corrupt, clean)).toBe(false);
    });

    it('prefers the clean row even when the corrupt row has the shorter name', () => {
        // Name length is the second tiebreak and would otherwise pick `corrupt`.
        const corrupt = row({ barcode: '111', name: 'Cola', corruptReason: 'panel-inflated:foodtype-sibling' });
        const clean = row({ barcode: '222', name: 'Cola Classic 12oz' });

        expect(clean.name.length).toBeGreaterThan(corrupt.name.length);
        expect(isBetterRepresentative(clean, corrupt)).toBe(true);
        expect(isBetterRepresentative(corrupt, clean)).toBe(false);
    });

    it('prefers the clean row even when the corrupt row has the lower barcode', () => {
        // Barcode is the final deterministic tiebreak and would pick `corrupt`.
        const corrupt = row({ barcode: '000111', name: 'Soup', corruptReason: 'kcal-impossible:direct' });
        const clean = row({ barcode: '999888', name: 'Soup' });

        expect(corrupt.barcode < clean.barcode).toBe(true);
        expect(isBetterRepresentative(clean, corrupt)).toBe(true);
        expect(isBetterRepresentative(corrupt, clean)).toBe(false);
    });
});

describe('the guard changes nothing when corruptness is equal', () => {
    // These pin that the pre-existing ordering is untouched. If any of these
    // break, the guard has overreached beyond the corrupt/clean distinction.
    it('falls through to completeness when neither is corrupt', () => {
        const richer = row({ barcode: '222', name: 'Yogurt', nutrientsPer100g: FULL_PANEL, servingGrams: 150 });
        const sparser = row({ barcode: '111', name: 'Yogurt' });
        expect(isBetterRepresentative(richer, sparser)).toBe(true);
    });

    it('falls through to completeness when BOTH are corrupt', () => {
        const richer = row({
            barcode: '222', name: 'Yogurt', nutrientsPer100g: FULL_PANEL, servingGrams: 150,
            corruptReason: 'kcal-impossible:direct',
        });
        const sparser = row({ barcode: '111', name: 'Yogurt', corruptReason: 'kcal-impossible:direct' });
        expect(isBetterRepresentative(richer, sparser)).toBe(true);
    });

    it('falls through to name length, then barcode, on equal completeness', () => {
        expect(isBetterRepresentative(
            row({ barcode: '999', name: 'Cola' }),
            row({ barcode: '111', name: 'Cola Classic' }),
        )).toBe(true);

        expect(isBetterRepresentative(
            row({ barcode: '111', name: 'Cola' }),
            row({ barcode: '222', name: 'Cola' }),
        )).toBe(true);
    });

    it('is antisymmetric and deterministic across argument order', () => {
        // Re-runs must elect the same representative; a comparator that returns
        // true both ways would make election order-dependent.
        const pairs: Array<[Row, Row]> = [
            [row({ barcode: '111', name: 'A', corruptReason: 'x' }), row({ barcode: '222', name: 'A' })],
            [row({ barcode: '111', name: 'A' }), row({ barcode: '222', name: 'A' })],
            [row({ barcode: '111', name: 'A', corruptReason: 'x' }), row({ barcode: '222', name: 'A', corruptReason: 'y' })],
        ];
        for (const [a, b] of pairs) {
            expect(isBetterRepresentative(a, b)).toBe(!isBetterRepresentative(b, a));
        }
    });
});

describe('importing this script does not run it', () => {
    it('is import-safe, which is what makes the above testable at all', () => {
        // Before the require.main guard, importing dedupe-off-mark.ts executed
        // main() and connected to the production database. If that regresses,
        // this whole file becomes a data-op rather than a test.
        expect(typeof isBetterRepresentative).toBe('function');
    });
});
