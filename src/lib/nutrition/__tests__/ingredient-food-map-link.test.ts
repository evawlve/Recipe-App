/**
 * ingredientFoodMapLink — the mapper's prefixed foodId → IngredientFoodMap columns.
 *
 * Context, because the shape of this function is a reaction to a specific bug:
 * auto-map.ts used to write five `fatsecret*` fields that exist nowhere in the
 * IngredientFoodMap model, including `fatsecretFoodId: \`fdc:${id}\`` — a prefixed string
 * stuffed into a non-existent text column while a typed `fdcId Int?` sat unused. Prisma
 * rejects unknown args at runtime, so every one of those creates failed, inside a try whose
 * catch logs a warn. Recipe auto-mapping wrote nothing and reported nothing.
 *
 * The rule this encodes: return a COMPLETE link or null. Never a partial row, never a
 * guessed home for a source that has no column.
 */

import { ingredientFoodMapLink } from '../auto-map';

describe('ingredientFoodMapLink — storable sources', () => {
    it('routes fdc_<int> to the typed fdcId column, as a number', () => {
        const link = ingredientFoodMapLink('fdc_167762');
        expect(link).toEqual({ columns: { fdcId: 167762 }, source: 'fdc' });
        // Int column: a string here is a runtime Prisma error, not a coercion.
        expect(typeof link!.columns.fdcId).toBe('number');
    });

    it('routes off_<barcode> to offBarcode, keeping leading zeros', () => {
        // Barcodes are strings precisely because parseInt would eat the leading zero.
        expect(ingredientFoodMapLink('off_0123456789012')).toEqual({
            columns: { offBarcode: '0123456789012' },
            source: 'off',
        });
    });

    it('routes fs_<id> to fsId and STRIPS the prefix', () => {
        // FatSecretFood.fsId stores the bare food_id. Keeping the `fs_` prefix here would
        // violate the foreign key — the same prefix-mismatch class as the old `fdc:` hack.
        expect(ingredientFoodMapLink('fs_12345')).toEqual({
            columns: { fsId: '12345' },
            source: 'fs',
        });
    });

    it('does not strip an fs_ prefix from an id that merely contains it', () => {
        // slice(3) is positional, so guard that only a genuine leading prefix is removed.
        const link = ingredientFoodMapLink('fs_fs_9');
        expect(link).toEqual({ columns: { fsId: 'fs_9' }, source: 'fs' });
    });

    it('routes an unprefixed id to aiGeneratedFoodId', () => {
        expect(ingredientFoodMapLink('clx0abc123def456')).toEqual({
            columns: { aiGeneratedFoodId: 'clx0abc123def456' },
            source: 'ai',
        });
    });

    it('never emits more than one identity column', () => {
        for (const id of ['fdc_1', 'off_9', 'fs_7', 'clx0abc']) {
            expect(Object.keys(ingredientFoodMapLink(id)!.columns)).toHaveLength(1);
        }
    });
});

describe('ingredientFoodMapLink — unstorable sources return null', () => {
    it('refuses an empty fs id', () => {
        expect(ingredientFoodMapLink('fs_')).toBeNull();
    });

    it('refuses water_default, which resolves to no record at all', () => {
        expect(ingredientFoodMapLink('water_default')).toBeNull();
    });

    it('refuses a malformed fdc id rather than writing NaN', () => {
        expect(ingredientFoodMapLink('fdc_')).toBeNull();
        expect(ingredientFoodMapLink('fdc_abc')).toBeNull();
    });

    it('refuses an empty off barcode', () => {
        expect(ingredientFoodMapLink('off_')).toBeNull();
    });

    it('refuses null, undefined and empty string', () => {
        expect(ingredientFoodMapLink(null)).toBeNull();
        expect(ingredientFoodMapLink(undefined)).toBeNull();
        expect(ingredientFoodMapLink('')).toBeNull();
    });
});

describe('ingredientFoodMapLink — the columns it emits are real', () => {
    it('only ever names columns that exist on IngredientFoodMap', () => {
        // Guards the original defect directly: `fatsecret*` must never reappear here.
        const REAL_COLUMNS = new Set(['foodId', 'offBarcode', 'fdcId', 'fsId', 'aiGeneratedFoodId']);
        for (const id of ['fdc_167762', 'off_0123456789012', 'fs_12345', 'clx0abc123def456']) {
            for (const key of Object.keys(ingredientFoodMapLink(id)!.columns)) {
                expect(REAL_COLUMNS.has(key)).toBe(true);
            }
        }
    });
});
