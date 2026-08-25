/**
 * The serving fallback's two decisions — WHICH substitutes it considers, and in
 * WHAT ORDER — pinned here because nothing else can see them.
 *
 * winner-diff's --with-serving stage hydrates the WINNER only
 * (`resolveServings()` calls `hydrateAndSelectServing()` on the frozen pool's
 * winner and returns); it never runs `attemptServingFailureFallback()`. So a
 * frozen-pool receipt is green about this code whatever it does — the third kind
 * of blindness winner-gate.sh names for `src/app/api`, one layer down and
 * unlisted. These pins plus a live probe are the whole instrument.
 *
 * Owner of the measurements quoted:
 * KindaHealthyMobile `sync-docs/reports/2026-08-25_a8-the-catalogue-holds-13-of-31-and-the-within-brand-block.md` §4 K3.
 */
import { orderFallbacksByRerank } from '../map-ingredient-with-fallback';
import { coversNonBrandQueryToken } from '../simple-rerank';

const c = (id: string) => ({ id });

describe('orderFallbacksByRerank', () => {
    it('puts the reranker order ahead of the gather order', () => {
        // `filtered` arrives in GATHER order — gatherCandidates() pushes FDC, then
        // OFF, then the FatSecret lane — so the FS record the reranker liked is
        // always LAST, which is why the old `filtered.slice(0, 3)` could not reach
        // it. 9 of the 12 logged fallback winners in the A8 census were `off_` rows.
        const gathered = [c('off_1'), c('off_2'), c('off_3'), c('fs_9')];
        expect(orderFallbacksByRerank(gathered, ['fs_9', 'off_2', 'off_1', 'off_3']).map(x => x.id))
            .toEqual(['fs_9', 'off_2', 'off_1', 'off_3']);
    });

    it('keeps candidates the reranker never scored behind the ones it did, in gather order', () => {
        const gathered = [c('off_1'), c('unranked_a'), c('fs_9'), c('unranked_b')];
        expect(orderFallbacksByRerank(gathered, ['fs_9', 'off_1']).map(x => x.id))
            .toEqual(['fs_9', 'off_1', 'unranked_a', 'unranked_b']);
    });

    it('returns gather order untouched when the reranker never ran', () => {
        const gathered = [c('off_1'), c('fs_9')];
        expect(orderFallbacksByRerank(gathered, null).map(x => x.id)).toEqual(['off_1', 'fs_9']);
        // ...and does not mutate its input, which is the live `filtered` array.
        expect(gathered.map(x => x.id)).toEqual(['off_1', 'fs_9']);
    });
});

describe('the fallback identity guard, on the rows it was measured against', () => {
    // `hasCoreTokenMismatch()` was the only guard this path had, and CORE_FOOD_TOKENS
    // carries no `bacon`, `burger`, `fries`, `wings`, `nachos`, `sandwich` or
    // `biscuit` — so it declined to guard eight of the eleven venue rows.
    it('rejects a same-brand-pool substitute that covers no food token of the query', () => {
        expect(coversNonBrandQueryToken('Granola', 'first watch million dollar bacon', 'first watch'))
            .toBe(false);
        expect(coversNonBrandQueryToken('Stack', 'yard house poke nachos', 'yard house'))
            .toBe(false);
    });

    it('accepts the record the user actually described', () => {
        expect(coversNonBrandQueryToken('Million Dollar Bacon', 'first watch million dollar bacon', 'first watch'))
            .toBe(true);
        expect(coversNonBrandQueryToken('Poke Nachos', 'yard house poke nachos', 'yard house'))
            .toBe(true);
    });

    it('is not a same-item test — a sibling sharing the food noun still passes, by design', () => {
        // The guard is deliberately weak: it removes substitutes that are not the
        // FOOD, not ones that are the wrong VARIANT of it. Distinguishing
        // `Nachos BellGrande` from `Nachos Supreme` is the ranking work in A8 rows
        // 2-5, and doing it here would be the fallback re-deciding the pick.
        expect(coversNonBrandQueryToken('Nachos Supreme', 'taco bell nachos bellgrande', 'taco bell'))
            .toBe(true);
    });
});
