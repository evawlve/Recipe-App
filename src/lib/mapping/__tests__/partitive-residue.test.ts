import { stripPartitiveOfResidue, deriveMappingCacheKey } from '../cache-key';

/**
 * LANE S (plan 8 D1(c'), 2026-08-20): partitive-`of` residue strip at the
 * cache-key site. The unit surface is src/lib/mapping/partitive-residue.ts,
 * re-exported by cache-key.ts (the one public surface for cache keys, which is
 * what this file imports). Parser parity is pinned separately in
 * partitive-parity.test.ts.
 */

describe('stripPartitiveOfResidue', () => {
    describe('strips a single edge `of`', () => {
        it.each([
            ['of spinach', 'spinach'],
            ['garlic of', 'garlic'],
            // The ai-normalize re-introduction shape: "1 cup of rolled oats" ->
            // normalizedForm "of rolled rolled oats". The strip only clears the
            // edge `of`; the dup collapse is step 3's job in deriveMappingCacheKey.
            ['of rolled rolled oats', 'rolled rolled oats'],
        ])('%j -> %j', (input, expected) => {
            expect(stripPartitiveOfResidue(input)).toBe(expected);
        });

        it('drops AT MOST ONE per call: "of of salt" -> "of salt"', () => {
            expect(stripPartitiveOfResidue('of of salt')).toBe('of salt');
        });

        it('preserves case: "OF SPINACH" -> "SPINACH"', () => {
            expect(stripPartitiveOfResidue('OF SPINACH')).toBe('SPINACH');
        });
    });

    describe('refuses: never empties, never touches mid-`of`', () => {
        it.each([
            ['of'], // alone — stripping would empty the name
            [''],   // nothing to strip
            // Mid-`of` is deliberately OUT of scope: no lexicon separates
            // "firm of tofu" from "cream of wheat", and the parser keeps both.
            ['cream of wheat'],
            ['firm of tofu'],
            ['hearts of palm'],
            ['chicken of the sea'],
            ['honey bunches of oats'],
            ['leg of lamb'],
            ['wheat thins hint of salt'],
            ['campbells cream of mushroom soup'],
            // Corpus controls — raw lines whose every `of` is mid-string:
            ['1 cup of cream of wheat'],
            ['1 knob of butter'],
            ['a couple of eggs'],
            ['half a cup of rice'],
            ['pinch of salt'],
        ])('%j unchanged', (input) => {
            expect(stripPartitiveOfResidue(input)).toBe(input);
        });

        // '2 slices of' is the corpus's truncated line. As a RAW STRING its
        // trailing `of` IS an edge token, so the strip removes it — the rule
        // working as scoped ("never keep a dangling partitive at the edge"),
        // not a leak. The pipeline never feeds this raw line to the strip:
        // raw lines go through the parser, whose follower guard refuses the
        // skip and names the line the bare token 'of' — single-token input the
        // strip refuses (pinned in partitive-parity.test.ts).
        it('"2 slices of" (raw string, trailing edge token) -> "2 slices"', () => {
            expect(stripPartitiveOfResidue('2 slices of')).toBe('2 slices');
        });
    });

    describe('token boundaries — `of` must match a whole token', () => {
        it.each([
            ['tofu', 'tofu'],       // single token, and `of` only as a substring
            ['offal', 'offal'],     // leading `of` substring is not the token `of`
            ['offal of', 'offal'],  // the trailing whole token strips
        ])('%j -> %j', (input, expected) => {
            expect(stripPartitiveOfResidue(input)).toBe(expected);
        });
    });
});

describe('deriveMappingCacheKey step 0 integration', () => {
    it('residue and clean names converge on one key: "of spinach" == "spinach" == key "spinach"', () => {
        expect(deriveMappingCacheKey('of spinach', null)).toBe('spinach');
        expect(deriveMappingCacheKey('spinach', null)).toBe('spinach');
    });

    it('mid-`of` names key exactly as on master: "cream of wheat"', () => {
        // master behavior: canonicalizeCacheKey sorts [cream, of, wheat] onto itself.
        expect(deriveMappingCacheKey('cream of wheat', null)).toBe('cream of wheat');
    });

    // The idempotence exception the cache-key.ts doc block now records.
    // canonicalizeCacheKey token-sorts with no stopword list, so the mid-`of`
    // NAME "leg of lamb" (untouched by step 0) derives the KEY "lamb leg of",
    // whose `of` sits at an edge. Fed back in as a NAME, step 0 strips it —
    // derived KEYS are no longer always fixed points of the derivation. That is
    // acceptable because no pipeline path feeds a derived key back in as a
    // name: keys re-enter only via canonicalizeCacheKey / isMalformedCacheKey
    // (the legacy-key read fallback and the malformed-key predicate), both
    // untouched by step 0. Pinned here so the doc block cannot silently drift
    // from behavior.
    it('pins the key-feedback exception: KEY "lamb leg of" is not a strip fixed point', () => {
        expect(deriveMappingCacheKey('leg of lamb', null)).toBe('lamb leg of');
        expect(stripPartitiveOfResidue('lamb leg of')).not.toBe('lamb leg of');
        expect(stripPartitiveOfResidue('lamb leg of')).toBe('lamb leg');
    });
});
