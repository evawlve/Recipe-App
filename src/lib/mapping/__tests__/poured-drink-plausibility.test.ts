import { assessMacroPlausibility, assessRankTimePlausibility, assessSaveTimePlausibility } from '../macro-plausibility';

/**
 * Poured-drink dry-panel rank-time plausibility (S341 / D20). RANK-TIME ONLY (reason `rank:poured_drink_kcal_*`, counted in floorHit): a
 * brewed drink line whose head noun is coffee / espresso / americano / brew / tea / chai meeting a panel above 150 kcal/100g ranks that
 * record below drink records. The head is read from queryName only; exemption words are read over the whole queryName and headLine.
 */

const panel = (kcal: number) => ({ kcal, protein: 0, carbs: Math.min(kcal / 4, 100), fat: 0 });
const PREFIX = 'rank:poured_drink';
function poured(q: string, kcal: number, head?: string): boolean {
    return assessRankTimePlausibility(q, 'x', panel(kcal), head).reasons.some((r) => r.startsWith(PREFIX));
}

const FIRES: Array<[string, number]> = [
    ['espresso', 241], ['an espresso', 241], ['double espresso', 241], ['espresso shot', 241], ['masala chai', 375], ['a mug of chai', 375],
    ['thai iced tea', 333], ['vietnamese iced coffee', 220], ['twisted tea original', 446.4], ['coffee', 352], ['a cup of coffee', 352],
    ['iced coffee', 220], ['cold brew', 380], ['americano', 241], ['coffee with cream', 352], ['coffee in a mug', 352],
];
const SILENT: Array<[string, number]> = [
    ['espresso', 150], ['vietnamese iced coffee', 110], ['masala chai', 70], ['coffee cake', 400], ['espresso beans', 500],
    ['chocolate covered espresso beans', 500], ['instant coffee', 352], ['coffee creamer', 300], ['chai concentrate', 200],
    ['chai tea latte', 380], ['a latte', 397], ['a frappuccino', 380], ['a protein coffee', 380], ['bulletproof coffee', 180],
    ['whipped coffee', 300], ['iced coffee mix', 400], ['coffee ice cream', 250], ['bubble tea', 200], ['matcha tea', 300],
    ['ground coffee', 300], ['hot chocolate', 380], ['a glass of wine', 300], ['a beer', 300], ['espresso martini', 201],
    ['long island iced tea', 224], ['heavy cream in coffee', 342], ['honey in my tea', 304],
];

describe('poured-drink rank-time plausibility', () => {
    it.each(FIRES)('fires: %s at %s kcal/100g', (q, kcal) => {
        expect(poured(q, kcal)).toBe(true);
        expect(assessRankTimePlausibility(q, 'x', panel(kcal)).floorHit).toBe(true);
    });

    it.each(SILENT)('stays silent: %s at %s kcal/100g', (q, kcal) => {
        expect(poured(q, kcal)).toBe(false);
    });

    it('defers spirits: gin and rum stay silent', () => {
        expect(poured('gin', 378.3, '1 shot of gin')).toBe(false);
        expect(poured('rum', 398.2)).toBe(false);
    });

    it('never reads the head from headLine', () => {
        expect(poured('honey', 304, 'coffee with honey')).toBe(false);
    });

    it('exempts on a headLine exemption word', () => {
        expect(poured('espresso', 241, 'chocolate covered espresso beans')).toBe(false);
    });

    it('stays silent on a non-finite kcal', () => {
        expect(poured('espresso', NaN)).toBe(false);
    });

    it('leaves the save-time paths untouched', () => {
        expect(assessMacroPlausibility('espresso', 'Espresso', panel(241)).reasons.join('|')).not.toContain('poured_drink');
        expect(assessSaveTimePlausibility('espresso', 'Espresso', panel(241)).reasons.join('|')).not.toContain('poured_drink');
    });

    it('leaves the brewed-tea rule in place', () => {
        const r = assessRankTimePlausibility('tea', 'x', panel(100));
        expect(r.reasons.some((x) => x.startsWith('rank:brewed_tea_'))).toBe(true);
        expect(r.floorHit).toBe(true);
    });
});
