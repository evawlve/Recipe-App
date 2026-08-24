/**
 * stamp-validator-reviewed.test.ts — the plan, the vocabulary and the receipt.
 *
 * NO NETWORK, NO DATABASE. The write itself is three Prisma calls inside main()
 * and is deliberately not unit-tested; what IS tested is everything that decides
 * which rows get written and how they come back: a typo must refuse, not stamp
 * zero rows; an already-stamped row must be skipped unless --force; the receipt
 * must carry the PRIOR values so --undo can restore exactly them.
 */

import {
    DISPOSITIONS,
    StampError,
    buildReceipt,
    parseBatchTsv,
    parseDisposition,
    parseReceipt,
    parseWho,
    planStamps,
    renderPlan,
    reviewedByValue,
    type StampableRow,
} from '../stamp-validator-reviewed';
import { parseReviewedBy } from '../validator-triage-queue';

let seq = 0;
function row(over: Partial<StampableRow> = {}): StampableRow {
    seq++;
    return {
        id: `v${seq}`,
        normalizedForm: 'core fairlife power',
        foodId: 'off_0711620020636',
        verdict: 'SUSPECT',
        createdAt: new Date(Date.UTC(2026, 7, 10 + seq, 11, 35)),
        reviewedAt: null,
        reviewedBy: null,
        ...over,
    };
}
beforeEach(() => { seq = 0; });

describe('the vocabulary', () => {
    it('accepts every listed disposition and refuses anything else', () => {
        for (const d of Object.keys(DISPOSITIONS)) expect(parseDisposition(d)).toBe(d);
        expect(() => parseDisposition('evict')).toThrow(StampError);
        expect(() => parseDisposition(undefined)).toThrow(StampError);
    });

    it('refuses a who that would break the reader\'s split', () => {
        expect(parseWho('lane-a-2026-08-21')).toBe('lane-a-2026-08-21');
        expect(() => parseWho('lane a')).toThrow(/whitespace/);
        expect(() => parseWho('lane:a')).toThrow(/':'/);
        expect(() => parseWho('')).toThrow(StampError);
        expect(() => parseWho(undefined)).toThrow(StampError);
    });

    it('round-trips through the reader\'s parseReviewedBy()', () => {
        const v = reviewedByValue('lane-a-2026-08-21', 'cascade');
        expect(parseReviewedBy(v)).toEqual({ who: 'lane-a-2026-08-21', disposition: 'cascade' });
    });
});

describe('planStamps', () => {
    const req = { normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', disposition: 'cascade' as const };

    it('stamps every unstamped row of the pair and counts the panel', () => {
        const rows = [row(), row(), row({ verdict: 'OK' })];
        const plan = planStamps('lane-a', [req], rows);
        expect(plan.totalToWrite).toBe(3);
        expect(plan.pairs[0]).toMatchObject({ suspectCount: 2, okCount: 1, reviewedBy: 'lane-a:cascade' });
        expect(plan.pairs[0].skipAlreadyStamped).toHaveLength(0);
    });

    it('skips rows that already carry a stamp unless --force', () => {
        const at = new Date('2026-08-20T00:00:00Z');
        const rows = [row({ reviewedAt: at, reviewedBy: 'someone:watch' }), row()];
        const plan = planStamps('lane-a', [req], rows);
        expect(plan.totalToWrite).toBe(1);
        expect(plan.pairs[0].skipAlreadyStamped.map(r => r.id)).toEqual(['v1']);

        const forced = planStamps('lane-a', [req], rows, { force: true });
        expect(forced.totalToWrite).toBe(2);
        expect(forced.pairs[0].restamp.map(r => r.id)).toEqual(['v1']);
        expect(forced.pairs[0].skipAlreadyStamped).toHaveLength(0);
    });

    it('REFUSES the whole batch when any pair matches no rows — a typo must not stamp zero rows quietly', () => {
        const rows = [row()];
        expect(() => planStamps('lane-a', [req, { ...req, normalizedForm: 'fairlife core power' }], rows))
            .toThrow(/no verdict rows for "fairlife core power"/);
    });

    it('refuses a batch naming the same pair twice', () => {
        expect(() => planStamps('lane-a', [req, { ...req, disposition: 'dismiss' }], [row()])).toThrow(/named twice/);
    });

    it('keeps pairs separate by (normalizedForm, foodId), not by key alone', () => {
        const rows = [row(), row({ foodId: 'fs_999' })];
        const plan = planStamps('lane-a', [req], rows);
        expect(plan.totalToWrite).toBe(1);
        expect(plan.pairs[0].stamp[0].id).toBe('v1');
    });
});

describe('parseBatchTsv', () => {
    it('reads tab-separated pairs, ignores comments and blanks', () => {
        const text = '# key\tfoodId\tdisposition\ncore fairlife power\toff_0711620020636\tcascade\n\nc4 fruit pre punch workout\toff_0810076291826\trepoint\n';
        expect(parseBatchTsv(text)).toEqual([
            { normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', disposition: 'cascade' },
            { normalizedForm: 'c4 fruit pre punch workout', foodId: 'off_0810076291826', disposition: 'repoint' },
        ]);
    });

    it('refuses a malformed line, an unknown disposition, and an empty file', () => {
        expect(() => parseBatchTsv('core fairlife power off_0711620020636 cascade')).toThrow(/expected normalizedForm<TAB>/);
        expect(() => parseBatchTsv('a\tb\tevict')).toThrow(/Unknown disposition/);
        expect(() => parseBatchTsv('# nothing\n')).toThrow(/names no pairs/);
    });
});

describe('the receipt', () => {
    it('carries the PRIOR values of every written row, and parses back', () => {
        const prior = new Date('2026-08-20T00:00:00Z');
        const rows = [row({ reviewedAt: prior, reviewedBy: 'x:watch' }), row()];
        const plan = planStamps('lane-a', [{ normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', disposition: 'cascade' }], rows, { force: true });
        const at = new Date('2026-08-22T10:00:00Z');
        const receipt = buildReceipt(plan, at, 'D-A3 batch 1, Diego 2026-08-22', true);
        expect(receipt.rows).toEqual([
            { id: 'v1', normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', priorReviewedAt: prior.toISOString(), priorReviewedBy: 'x:watch', reviewedBy: 'lane-a:cascade' },
            { id: 'v2', normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', priorReviewedAt: null, priorReviewedBy: null, reviewedBy: 'lane-a:cascade' },
        ]);
        expect(receipt.grant).toBe('D-A3 batch 1, Diego 2026-08-22');
        expect(parseReceipt(JSON.stringify(receipt))).toEqual(receipt);
    });

    it('refuses a receipt that is not one', () => {
        expect(() => parseReceipt('{}')).toThrow(/not a validator-stamps receipt/);
        expect(() => parseReceipt('nope')).toThrow(/not JSON/);
    });
});

describe('renderPlan', () => {
    it('says DRY RUN unless applying, and names the disposition meaning', () => {
        const plan = planStamps('lane-a', [{ normalizedForm: 'core fairlife power', foodId: 'off_0711620020636', disposition: 'cascade' }], [row()]);
        const dry = renderPlan(plan, { apply: false, force: false });
        expect(dry).toMatch(/DRY RUN — nothing written/);
        expect(dry).toMatch(/A4 serving-axis pile/);
        expect(renderPlan(plan, { apply: true, force: false })).toMatch(/\(APPLY\)/);
    });
});
