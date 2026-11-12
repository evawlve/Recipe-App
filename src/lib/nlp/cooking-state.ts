/**
 * cookingState — which cooking basis a parse item's panel is on, for a plain cut of
 * meat, poultry or fish (s456 CS, 2026-11-12; Diego's word "Defaults ok": a weighed meat
 * line with no cooking word stays RAW and the card says so).
 *
 * WIRE: an optional field on every /api/nlp/parse item, one-shot and streamed alike.
 * OMITTED (never null) whenever this returns null, so every other item stays
 * byte-identical. Values:
 *   'cooked'      the RESOLVED RECORD's name states a cooking word ("Grilled Chicken",
 *                 "Beef Chuck (..., Cooked, Braised)").
 *   'raw'         the record is raw-basis AND the user's line said raw/uncooked.
 *   'raw_default' the record is raw-basis and the line did NOT say raw — the pipeline's
 *                 default (detectGrainCookingContext() in filter-candidates.ts prefers raw
 *                 when the line has no cooking word). A cooked line on a raw record also
 *                 reads raw_default: the number is raw-basis whatever the line said.
 *
 * READS THE RECORD, NOT THE LINE'S CONTEXT. A no-word line can still win a cooked record
 * (human-trusted cache rows and relaxed passes bypass isWrongCookingStateForGrain()), and
 * the card must describe the number it bills. Raw-basis means: the name says raw/uncooked,
 * OR the name is silent and the record is an Open Food Facts retail product (raw meat is
 * sold raw; a cooked product says so on the pack). A silent FatSecret / FDC / AI record
 * makes NO claim: FatSecret's generic "Chicken Breast" (fs_1641) bills 195 kcal/100 g and
 * "Chicken Thigh" (fs_1695) 245 — cooked-basis panels under raw-sounding names (MEL
 * 30-day medians, measured 2026-11-12). No claim is always safe. A silent OFF record on a
 * line that names a packaged form (a can, deli slices, jerky) also makes no claim.
 * `source` is the route's floored `standardSource`, so an AI-backfilled panel (panelFromAi)
 * arrives as 'ai_estimated' and only its name can speak for it.
 *
 * SCOPE: plain cuts only. The name's HEAD (parentheses removed, cut at the first comma)
 * must hold a FAMILY word and nothing outside FAMILY + CUT + the state words — so
 * "Chicken Tenders", "Turkey Sandwich", "Roast Beef", "Beef Stick", "Chicken Noodle Soup"
 * are omitted. Grains, legumes, eggs and vegetables are OUT: the same detector handles
 * them, but their default flips with the unit (volume -> cooked) and their word is "dry",
 * not "raw" — a separate wording decision.
 *
 * NOT FoodMapping.cookingModifier: NULL on ~97% of live rows (estimate-state-guard.ts).
 * A cache hit carries the same foodName and foodId prefix as a cold resolve, so this
 * derives identically on both paths.
 */

export type CookingState = 'raw_default' | 'raw' | 'cooked';
export type CookingStateSource = 'fatsecret' | 'fdc' | 'openfoodfacts' | 'ai_estimated';

const FAMILY = new Set([
    'beef', 'steak', 'steaks', 'sirloin', 'ribeye', 'chuck', 'brisket',
    'chicken', 'turkey', 'pork', 'lamb', 'veal', 'venison', 'bison', 'duck',
    'salmon', 'cod', 'tilapia', 'halibut', 'trout', 'shrimp', 'prawn', 'prawns',
]);

const CUT = new Set([
    'breast', 'breasts', 'thigh', 'thighs', 'drumstick', 'drumsticks', 'wing', 'wings',
    'leg', 'legs', 'quarter', 'quarters', 'tenderloin', 'tenderloins', 'loin', 'chop', 'chops',
    'cutlet', 'cutlets', 'fillet', 'fillets', 'filet', 'filets', 'rib', 'ribs', 'eye', 'strip',
    'strips', 'flank', 'skirt', 'top', 'round', 'shoulder', 'butt', 'shank', 'belly',
    'ground', 'minced', 'mince', 'lean', 'extra', 'fat', 'skinless', 'boneless', 'bone',
    'skin', 'in', 'on', 'and', 'meat', 'only', 'dark', 'white', 'whole', 'organic', 'fresh',
    'natural', 'all', 'wild', 'atlantic', 'farmed', 'sockeye', 'coho', 'king',
    'peeled', 'deveined', 'jumbo', 'large', 'medium', 'small', 'tail', 'off', 'blade', 'new', 'york',
]);

const COOKED_WORDS = [
    'cooked', 'prepared', 'boiled', 'steamed', 'roasted', 'grilled', 'baked', 'fried',
    'sauteed', 'braised', 'stewed', 'broiled', 'poached', 'smoked', 'rotisserie',
    'barbecued', 'bbq', 'seared', 'blackened',
];
const RAW_WORDS = ['raw', 'uncooked'];
const STATE = new Set([...COOKED_WORDS, ...RAW_WORDS, 'pan']);

/** A line that names a packaged-cooked FORM (deli slices, a can) makes no raw claim. */
const LINE_PACKAGED_RE = /\b(?:cans?|canned|tins?|tinned|slices?|deli|jerky)\b/;

const COOKED_WORD_RE = new RegExp(`\\b(?:${COOKED_WORDS.join('|')})\\b`);
const RAW_WORD_RE = new RegExp(`\\b(?:${RAW_WORDS.join('|')})\\b`);

function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function cookingStateFor(input: {
    rawText: string;
    foodName: string;
    source: CookingStateSource;
}): CookingState | null {
    const name = fold(input.foodName);
    const head = name.replace(/\([^)]*\)/g, ' ').split(',')[0];
    const tokens = head.split(/[^a-z]+/).filter(Boolean);
    if (!tokens.some(t => FAMILY.has(t))) return null;
    if (!tokens.every(t => FAMILY.has(t) || CUT.has(t) || STATE.has(t))) return null;

    const recordRaw = RAW_WORD_RE.test(name);
    if (!recordRaw && COOKED_WORD_RE.test(name)) return 'cooked';
    if (!recordRaw && input.source !== 'openfoodfacts') return null;
    const line = fold(input.rawText);
    if (!recordRaw && LINE_PACKAGED_RE.test(line)) return null;
    return RAW_WORD_RE.test(line) ? 'raw' : 'raw_default';
}
