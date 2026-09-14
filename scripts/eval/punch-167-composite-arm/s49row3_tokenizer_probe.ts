/**
 * s49row3_tokenizer_probe.ts — Lane A S49 ROW 3.
 *
 * PURE. No DB, no LLM, no writes. Imports the SHIPPED preserveDroppedBrand()
 * from this tree and asks, per census row, which of three containment tests
 * stops the brand being doubled:
 *
 *   (a) TODAY   — `baseName.toLowerCase().includes(lowerBrand)`, the shipped form.
 *   (b) #407    — `canonicalizeBrandKey(baseName).includes(canonicalizeBrandKey(brand))`,
 *                 VERBATIM from `git show 903dd09:src/lib/mapping/brand-detector.ts`
 *                 (the kept-and-closed branch). Folded, still CONTIGUOUS.
 *   (c) TOKEN-SET — folded brand tokens as a SUBSET of folded baseName tokens.
 *
 * Inputs are inverted from the committed anc-rows.tsv census: a census row's
 * col2 is the post-repair baseName, which preserveDroppedBrand() built as
 * `${targetBrand} ${rederived}`, so brand+tail are recoverable by splitting at
 * the known brand prefix. Every row is replayed through the SHIPPED function to
 * confirm the doubling reproduces before any alternative is scored.
 */
import { preserveDroppedBrand } from '@/lib/mapping/quantity-word-brand';

/** VERBATIM from `git show 903dd09:src/lib/mapping/brand-detector.ts` — the #407 fold. */
function canonicalizeBrandKey(value: string): string {
    return value
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const SEEDS: Array<{ brand: string; tail: string; serves: number; note: string }> = [
    // the five census rows named by the S47 report (serves from anc-rows.tsv col1)
    { brand: "M&M's",            tail: 'm and ms pretzel',                            serves: 24, note: 'census / &-vs-and' },
    { brand: "m&m's",            tail: 'a fun size bag of m&ms',                      serves: 2,  note: 'census / apostrophe' },
    { brand: 'Noodles & Company',tail: 'noodles and company pad thai',                serves: 1,  note: 'census / &-vs-and' },
    { brand: 'Optimum Nutrition',tail: 'optimum weigh nutrition protein',             serves: 1,  note: 'census / NON-ADJACENT' },
    { brand: 'Optimum Nutrition',tail: 'and a half of optimum weight nutrition protein', serves: 1, note: 'census / NON-ADJACENT' },
    // the class WORKING — a fix must not break these
    { brand: "Ben & Jerry's",    tail: 'ben and jerrys cherry garcia',                serves: 19, note: 'WORKING / &-vs-and' },
    { brand: "Ben & Jerry's",    tail: 'and ben jerry',                               serves: 19, note: 'WORKING / &-vs-and + plural' },
];

function tokenSetCovers(brand: string, name: string): boolean {
    const bt = canonicalizeBrandKey(brand).split(' ').filter(Boolean);
    const nt = new Set(canonicalizeBrandKey(name).split(' ').filter(Boolean));
    return bt.length > 0 && bt.every(t => nt.has(t));
}

console.warn('brand | tail | serves | SHIPPED result | (a) today | (b) #407 fold | (c) token-set | note');
let aDouble = 0, bDouble = 0, cDouble = 0, aServes = 0, bServes = 0, cServes = 0;
for (const s of SEEDS) {
    // The SHIPPED function, on the composite-path shape: segmenter supplied the
    // brand, baseName is the segmenter's normalizedForm, rederived == that name.
    const shipped = preserveDroppedBrand({
        rawLine: s.tail, baseName: s.tail, targetBrand: s.brand,
        rederived: s.tail, parsed: null,
    });
    const a = !s.tail.toLowerCase().includes(s.brand.toLowerCase());           // true => doubles
    const b = !canonicalizeBrandKey(s.tail).includes(canonicalizeBrandKey(s.brand));
    const c = !tokenSetCovers(s.brand, s.tail);
    if (a) { aDouble++; aServes += s.serves; }
    if (b) { bDouble++; bServes += s.serves; }
    if (c) { cDouble++; cServes += s.serves; }
    console.warn(
        `${s.brand} | ${s.tail} | ${s.serves} | applied=${shipped.applied} -> "${shipped.baseName}" | ` +
        `${a ? 'DOUBLES' : 'ok'} | ${b ? 'DOUBLES' : 'ok'} | ${c ? 'DOUBLES' : 'ok'} | ${s.note}`);
}
console.warn('');
console.warn(`(a) today     : ${aDouble}/7 rows double, ${aServes} serves`);
console.warn(`(b) #407 fold : ${bDouble}/7 rows double, ${bServes} serves`);
console.warn(`(c) token-set : ${cDouble}/7 rows double, ${cServes} serves`);
