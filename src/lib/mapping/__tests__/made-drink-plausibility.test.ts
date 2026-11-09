import { assessMacroPlausibility, assessRankTimePlausibility, assessSaveTimePlausibility } from '../macro-plausibility';

/**
 * Made-drink dry-panel rank-time plausibility (s453-P1). RANK-TIME ONLY (reason `rank:made_drink_kcal_*`, counted in floorHit): a line
 * whose head is hot chocolate / hot cocoa / cafe con leche / cafe au lait / leche con chocolate / chocolate caliente / chocolate milk /
 * cider / horchata / atole meeting a panel above 150 kcal/100g ranks that record below drink records. The head is read from queryName
 * only; exemption words are read over the whole queryName and headLine. Bare `cocoa` is not a head (usually the powder).
 */

const panel = (kcal: number) => ({ kcal, protein: 0, carbs: Math.min(kcal / 4, 100), fat: 0 });
const PREFIX = 'rank:made_drink_kcal_';
function made(q: string, kcal: number, head?: string): boolean {
    return assessRankTimePlausibility(q, 'x', panel(kcal), head).reasons.some((r) => r.startsWith(PREFIX));
}

const FIRES: Array<[string, number]> = [
    ['hot chocolate', 387], ['a hot chocolate', 387], ['hot chocolates', 382], ['peppermint hot chocolate', 561],
    ['starbucks hot chocolate', 357.1], ['swiss miss hot chocolate', 422.2], ['hot chocolate large', 387], ['hot cocoa', 360],
    ['a mug of hot cocoa', 320], ['cafe con leche', 470.6], ['café con leche', 470.6], ['cafe au lait', 438],
    ['leche con chocolate', 433.3], ['chocolate caliente', 233], ['slate chocolate milk', 370], ['hot cider', 391.3],
    ['hot mulled cider', 391.3], ['horchata', 425], ['atole', 333.3],
];
const SILENT: Array<[string, number]> = [
    ['hot chocolate', 150], ['chocolate milk', 140], ['hot chocolate mix', 400], ['hot cocoa powder', 400], ['cocoa powder', 400],
    ['cocoa', 400], ['unsweetened cocoa', 400], ['dutch process cocoa', 283], ['hot chocolate bomb', 450], ['hot chocolate k-cup', 368],
    ['milk chocolate', 535], ['chocolate', 535], ['apple cider vinegar', 300], ['cider donut', 400], ['dulce de leche', 320],
    ['arroz con leche', 200], ['horchata mix', 400], ['atole mix', 372], ['chocolate milk protein shake', 380],
    ['chocolate caliente mix', 400], ['leche', 400], ['hot chocolate packet', 420], ['nesquik chocolate milk powder', 380],
];
// Head intact; ONLY an exemption word silences each of these.
const EXEMPT_ONLY: Array<[string, number, string | undefined]> = [
    ['hot chocolate', 420, '1 packet hot chocolate'], ['hot cocoa', 400, '2 tbsp hot cocoa'], ['hot chocolate', 400, '1 scoop hot chocolate'],
    ['horchata', 425, '1 envelope horchata'], ['unsweetened hot cocoa', 400, undefined], ['dutch hot cocoa', 400, undefined],
    ['hard cider', 300, undefined], ['protein hot chocolate', 380, undefined], ['instant hot chocolate', 400, undefined],
];

describe('made-drink rank-time plausibility', () => {
    it.each(FIRES)('fires: %s at %s kcal/100g', (q, kcal) => {
        expect(made(q, kcal)).toBe(true);
        expect(assessRankTimePlausibility(q, 'x', panel(kcal)).floorHit).toBe(true);
    });

    it.each(SILENT)('stays silent: %s at %s kcal/100g', (q, kcal) => {
        expect(made(q, kcal)).toBe(false);
    });

    it.each(EXEMPT_ONLY)('exempt only: %s at %s kcal/100g (headLine %s)', (q, kcal, head) => {
        expect(made(q, kcal, head)).toBe(false);
    });

    it('never reads the head from headLine', () => {
        expect(made('honey', 304, 'hot chocolate with honey')).toBe(false);
    });

    it('stays silent on a non-finite kcal', () => {
        expect(made('hot chocolate', NaN)).toBe(false);
    });

    it('DEFERRED: a whole-query exemption scope is not this row (cloud-43 F9)', () => {
        expect(made('hot cocoa with whipped cream', 360)).toBe(false);
    });

    it('is independent of the poured rule', () => {
        const r = assessRankTimePlausibility('hot chocolate', 'x', panel(380));
        expect(r.reasons.some((x) => x.startsWith('rank:poured_drink'))).toBe(false);
        expect(r.reasons.some((x) => x.startsWith(PREFIX))).toBe(true);
    });

    it('leaves the save-time paths untouched', () => {
        expect(assessMacroPlausibility('hot chocolate', 'Hot Chocolate', panel(387)).reasons.join('|')).not.toContain('made_drink');
        expect(assessSaveTimePlausibility('hot chocolate', 'Hot Chocolate', panel(387)).reasons.join('|')).not.toContain('made_drink');
    });
});
