import { textOf, matchesAlt, isAbstention, numberDrifted, describeDrift, allRequestsRefused } from '../assertions';

/**
 * The exact wire shape the no-pick branch returns
 * (src/app/api/nlp/parse/route.ts:307-341). Note foodName echoes the query.
 */
function abstentionFor(query: string) {
    return {
        rawText: query,
        foodName: query,
        brandName: null,
        foodId: undefined,
        source: 'ai_estimated',
        matchConfidence: 0.0,
        servingConfidence: 0.0,
        grams: 0,
        nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 },
        nutritionPer100g: { kcal100: 0, protein100: 0, carbs100: 0, fat100: 0 },
        servingOptions: [],
    };
}

/** A normal successful mapping. */
function pick(foodName: string, brandName: string | null, conf = 0.95) {
    return { foodName, brandName, foodId: 'fs_1112991', source: 'fatsecret', matchConfidence: conf, grams: 320 };
}

describe('isAbstention', () => {
    it('recognises the no-pick shape', () => {
        expect(isAbstention(abstentionFor('chipotle chicken burrito'))).toBe(true);
    });

    it('does NOT flag a real pick', () => {
        expect(isAbstention(pick('Chicken Queso Burrito', 'Qdoba Mexican Grill'))).toBe(false);
    });

    it('does NOT flag an AI-estimated pick that still produced a record', () => {
        // The "100g AI backfill" shape: source is also ai_estimated, but it has a
        // foodId and a real confidence. Conflating the two would let a fabricated
        // estimate be accepted as a legitimate abstention.
        expect(isAbstention({ foodName: 'Burrito', foodId: 'ai_123', source: 'ai_estimated', matchConfidence: 0.55, grams: 100 })).toBe(false);
    });

    it('requires BOTH a missing id and zero confidence', () => {
        expect(isAbstention({ foodId: undefined, matchConfidence: 0.4 })).toBe(false);
        expect(isAbstention({ foodId: 'off_123', matchConfidence: 0 })).toBe(false);
    });

    it('is safe on null/undefined', () => {
        expect(isAbstention(null)).toBe(false);
        expect(isAbstention(undefined)).toBe(false);
    });
});

describe('an abstention must never satisfy a positive name assertion', () => {
    // This is the bug. The no-pick branch echoes the query back as foodName, so
    // substring containment matched trivially and the mapper answering "I have
    // nothing" scored a pass on 47 of the 238 nlp cases.
    const expectName = [['burrito']];

    it('the raw text of an abstention DOES contain the expected word (the trap)', () => {
        expect(textOf(abstentionFor('chipotle chicken burrito'))).toContain('burrito');
        expect(matchesAlt(textOf(abstentionFor('chipotle chicken burrito')), expectName)).toBe(true);
    });

    it('...but the guarded check rejects it', () => {
        const items = [abstentionFor('chipotle chicken burrito')];
        const guarded = items.some(it => !isAbstention(it) && matchesAlt(textOf(it), expectName));
        expect(guarded).toBe(false);
    });

    it('and still accepts a genuine match', () => {
        const items = [pick('Chicken Queso Burrito', 'Qdoba Mexican Grill')];
        const guarded = items.some(it => !isAbstention(it) && matchesAlt(textOf(it), expectName));
        expect(guarded).toBe(true);
    });

    it('a multi-item segmentation case still passes when one real item matches', () => {
        const items = [abstentionFor('zzz'), pick('Chicken Burrito', null)];
        const guarded = items.some(it => !isAbstention(it) && matchesAlt(textOf(it), expectName));
        expect(guarded).toBe(true);
    });
});

describe('forbidName', () => {
    const forbid = [['tequila lime']];

    it('catches the component that composite drift resolves to', () => {
        const items = [pick('Qdoba, Tequila Lime Chicken', 'Qdoba')];
        const offender = items.find(it => !isAbstention(it) && matchesAlt(textOf(it), forbid));
        expect(offender).toBeDefined();
    });

    it('passes when the assembled record wins', () => {
        const items = [pick('Chicken Queso Burrito', 'Qdoba Mexican Grill')];
        expect(items.find(it => !isAbstention(it) && matchesAlt(textOf(it), forbid))).toBeUndefined();
    });

    it('an abstention cannot trip a NEGATIVE assertion either', () => {
        // Symmetry matters: the echoed query text must not count as a forbidden match.
        const items = [abstentionFor('qdoba tequila lime chicken burrito')];
        expect(items.find(it => !isAbstention(it) && matchesAlt(textOf(it), forbid))).toBeUndefined();
    });
});

describe('matchesAlt normalization (hyphen/space variants)', () => {
    it('alt "pre workout" matches record name "Pre-workout" — the n-supp-20 shape', () => {
        // Raw substring containment could never satisfy this: "pre-workout"
        // contains no "pre workout". The record is real (off_9680463978828).
        expect(matchesAlt(textOf({ foodName: 'Pre-workout', brandName: null }), [['pre workout']])).toBe(true);
    });

    it('matches in the other direction too (hyphenated alt, spaced record)', () => {
        expect(matchesAlt(textOf({ foodName: 'Pre Workout', brandName: null }), [['pre-workout']])).toBe(true);
    });

    it('preserves partial-token prefixes (the golden set relies on "strawberr")', () => {
        expect(matchesAlt(textOf({ foodName: 'Strawberries', brandName: null }), [['strawberr']])).toBe(true);
    });

    it('is still sequence containment, NOT token-set membership', () => {
        expect(matchesAlt(textOf({ foodName: 'Chicken Burrito Bowl', brandName: null }), [['chicken burrito']])).toBe(true);
        expect(matchesAlt(textOf({ foodName: 'Chicken Burrito Bowl', brandName: null }), [['burrito chicken']])).toBe(false);
    });

    it('ignores punctuation noise inside the record name', () => {
        expect(matchesAlt(textOf({ foodName: "Ben & Jerry's Chocolate", brandName: null }), [['ben jerry']])).toBe(true);
    });

    it('a punctuation-only sub keeps the OLD raw-containment semantics, never a vacuous pass', () => {
        expect(matchesAlt('m&m chocolate ', [['&']])).toBe(true);   // raw containment, as before
        expect(matchesAlt('plain chocolate ', [['&']])).toBe(false); // must NOT match via ''.includes('')
    });
});

describe('textOf', () => {
    it('joins name and brand from either naming convention', () => {
        expect(textOf({ foodName: 'Pad Thai', brandName: 'Noodles & Company' })).toBe('pad thai noodles & company');
        expect(textOf({ name: 'Harissa', brand: 'Cava' })).toBe('harissa cava');
    });

    it('tolerates missing fields', () => {
        expect(textOf({})).toBe(' ');
        expect(textOf({ foodName: 'Burrito' })).toBe('burrito ');
    });
});

describe('numberDrifted', () => {
    it('ignores noise within 10%', () => {
        expect(numberDrifted(100, 105)).toBe(false);
        expect(numberDrifted(361, 380)).toBe(false);
    });

    it('flags a move beyond 10%', () => {
        expect(numberDrifted(100, 120)).toBe(true);
    });

    it('ALWAYS flags a move onto or off zero', () => {
        // This is the n-cook-06 case: 361 kcal/100g (wrong record) -> 0 (no nutrition
        // at all). Both fail the same band, so only a value comparison can see it.
        expect(numberDrifted(361, 0)).toBe(true);
        expect(numberDrifted(0, 361)).toBe(true);
    });

    it('flags appearing/disappearing values', () => {
        expect(numberDrifted(null, 100)).toBe(true);
        expect(numberDrifted(100, null)).toBe(true);
        expect(numberDrifted(null, null)).toBe(false);
    });

    it('treats null and undefined as the SAME absent value', () => {
        // The baseline writer stores `?? null`; a live search result simply has no
        // `grams` key. A strict !== read that as "null -> undefined" drift and falsely
        // reported s-typo-08 and s-typo-14 as changed on the first real run.
        expect(numberDrifted(null, undefined)).toBe(false);
        expect(numberDrifted(undefined, null)).toBe(false);
        expect(numberDrifted(undefined, undefined)).toBe(false);
    });
});

describe('describeDrift', () => {
    it('reports nothing when a knownIssue fails the same way', () => {
        const was = { foodId: 'off_1', foodName: 'Rolled Oats', grams: 234, kcal100: 361 };
        expect(describeDrift(was, { ...was })).toEqual([]);
    });

    it('reports the n-cook-06 degradation a boolean could not', () => {
        const was = { foodId: 'off_1', foodName: 'Rolled Oats', grams: 234, kcal100: 361 };
        const now = { foodId: 'off_2', foodName: 'oats', grams: 234, kcal100: 0 };
        const drift = describeDrift(was, now);
        expect(drift.join(' ')).toContain('record off_1 -> off_2');
        expect(drift.join(' ')).toContain('kcal100 361 -> 0');
    });

    it('reports a case that started abstaining', () => {
        const was = { foodId: 'off_1', foodName: 'Chipotle, Chicken', grams: 118, kcal100: 141, abstained: false };
        const now = { foodId: null, foodName: 'chipotle chicken burrito', grams: 0, kcal100: 0, abstained: true };
        expect(describeDrift(was, now).join(' ')).toContain('abstained false -> true');
    });
});

describe('allRequestsRefused — an all-401 run is an auth failure, not a result', () => {
    it('is true when every result carries 401 (or 403)', () => {
        expect(allRequestsRefused([{ httpStatus: 401 }, { httpStatus: 401 }, { httpStatus: 403 }])).toBe(true);
    });
    it('is false when even one request got through', () => {
        expect(allRequestsRefused([{ httpStatus: 401 }, { httpStatus: 200 }])).toBe(false);
    });
    it('is false on an empty run (that is the zero-case path, already exit 2)', () => {
        expect(allRequestsRefused([])).toBe(false);
    });
    it('does not treat status-less transport errors as refusals', () => {
        expect(allRequestsRefused([{}, { httpStatus: 401 }])).toBe(false);
    });
});
