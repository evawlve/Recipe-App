import { assessRankTimePlausibility } from '../macro-plausibility';

/**
 * C70 / cloud-38 D14: a size or measure word that the unit table reads (`large`, `small`, `medium`, `cup`, `bottle` ...) before the head
 * `tea` is allowed by brewedTeaReason(); unknown words (brands, flavours) still decline.
 */

const panel = (kcal: number) => ({ kcal, protein: 0, carbs: Math.min(kcal / 4, 100), fat: 0 });
function tea(q: string, kcal: number): boolean {
    return assessRankTimePlausibility(q, 'x', panel(kcal)).reasons.some((r) => r.startsWith('rank:brewed_tea_kcal_'));
}

test('G13 brewed tea: a size word before `tea` is still a plain brewed-tea ask', () => {
    expect(assessRankTimePlausibility('a large tea', 'Tea', { kcal: 250, protein: 0, fat: 0, carbs: 62 }).floorHit).toBe(true);
});

describe('size words before tea', () => {
    it.each<[string, number]>([['a small tea', 100], ['a medium black tea', 34], ['a large cup of tea', 100]])(
        'fires: %s at %s kcal/100g',
        (q, kcal) => expect(tea(q, kcal)).toBe(true)
    );
    it.each<[string, number]>([
        ['a large tea', 10], ['a large sweet tea', 80], ['a large iced tea', 60], ['a large thai tea', 90], ['a large peace tea', 39],
        ['large tea cake', 350],
    ])('does not fire: %s at %s kcal/100g', (q, kcal) => expect(tea(q, kcal)).toBe(false));
});
