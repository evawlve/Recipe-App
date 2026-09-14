/**
 * s49row3_fixture_tripwire.ts — does the shipped REPLAY fixture in
 * src/lib/mapping/__tests__/quantity-word-brand.test.ts actually TRIP when the
 * containment check is folded / made token-set?
 *
 * PURE. The 18 REPLAY rows are copied verbatim from that file.
 */
import { preserveDroppedBrand } from '@/lib/mapping/quantity-word-brand';
import { detectBrandInQuery } from '@/lib/mapping/brand-detector';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { stripPartitiveOfResidue } from '@/lib/mapping/partitive-residue';

const canon = (v: string) => v.toLowerCase().replace(/['’`]/g, '').replace(/&/g, ' and ')
    .replace(/[-.\/]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (v: string) => canon(v).split(' ').filter(Boolean);
const setCovers = (b: string, n: string) => {
    const bt = toks(b), nt = new Set(toks(n));
    return bt.length > 0 && bt.every(t => nt.has(t));
};

const REPLAY: Array<[string, string, string | undefined]> = [
    ['2 scoops ghost vegan protein cinnamon roll', 'vegan protein cinnamon roll', undefined],
    ['mcdonalds sausage mcmuffin with egg', 'sausage mcmuffin with egg', undefined],
    ['kraft deluxe macaroni and cheese', 'macaroni and cheese', undefined],
    ['velveeta shells and cheese', 'shells and cheese', undefined],
    ['a Chobani 20 g protein mixed berry yogurt', 'mixed berry yogurt', undefined],
    ['starbucks iced brown sugar oatmilk shaken espresso', 'iced shaken espresso', undefined],
    ['oikos triple zero vanilla', 'oikos triple zero vanilla', undefined],
    ['12 oz coke', 'coke', 'Coca-Cola'],
    ['chick fil a spicy sandwich', 'spicy sandwich', 'chick-fil-a'],
    ['coca cola', 'cola', 'Coca-Cola'],
    ['grilled cheese in n out', 'grilled cheese', 'in-n-out'],
    ['one slice of Swiss cheese', 'Swiss cheese', undefined],
    ['one medium banana', 'banana', undefined],
    ['one and a half cups milk', 'milk', undefined],
    ['one bar birthday cake', 'birthday cake', undefined],
    ['one protein bar', 'protein bar', undefined],
    ['squirt soda', 'soda', undefined],
    ['noodles and company pad thai', 'pad thai', 'Noodles and Company'],
];

/** preserveDroppedBrand's body with the containment rule swapped. */
function variant(mode: 'plain' | 'fold' | 'set', baseName: string, targetBrand: string, rederived: string) {
    const lb = targetBrand.toLowerCase();
    const carries = (s: string) =>
        mode === 'plain' ? s.toLowerCase().includes(lb)
        : mode === 'fold' ? canon(s).includes(canon(targetBrand))
        : setCovers(targetBrand, s);
    if (carries(baseName)) return { baseName, applied: false };
    return { baseName: carries(rederived) ? rederived : `${targetBrand} ${rederived}`.trim(), applied: true };
}

let n = 0, dFold = 0, dSet = 0;
console.warn('row | shipped(plain) | fold | token-set');
for (const [rawLine, normalizedForm, segBrand] of REPLAY) {
    const parsed = parseIngredientLine(rawLine);
    const baseName = stripPartitiveOfResidue(normalizedForm);
    const targetBrand = segBrand || detectBrandInQuery(rawLine).matchedBrand;
    if (!targetBrand) continue;
    const rederived = parsed?.name?.trim() || rawLine;
    n++;
    const shipped = preserveDroppedBrand({ rawLine, baseName, targetBrand, rederived, parsed });
    const f = variant('fold', baseName, targetBrand, rederived);
    const s = variant('set', baseName, targetBrand, rederived);
    const df = shipped.declined ? false : (f.baseName !== shipped.baseName || f.applied !== shipped.applied);
    const ds = shipped.declined ? false : (s.baseName !== shipped.baseName || s.applied !== shipped.applied);
    if (df) dFold++;
    if (ds) dSet++;
    if (df || ds) {
        console.warn(`DISAGREE  ${rawLine}`);
        console.warn(`     shipped: "${shipped.baseName}"`);
        if (df) console.warn(`     fold   : "${f.baseName}"`);
        if (ds) console.warn(`     set    : "${s.baseName}"`);
    }
}
console.warn('');
console.warn(`rows with a brand (the test's own population): ${n} of ${REPLAY.length}`);
console.warn(`baseName disagreements vs shipped — fold: ${dFold}   token-set: ${dSet}`);
console.warn(dFold > 0 || dSet > 0
    ? 'TRIPWIRE FIRES: the equivalence test goes RED on a containment change.'
    : 'TRIPWIRE SILENT: the fixture cannot see a containment change.');
