/**
 * cookingState — which cooking basis a parse item's panel is on, for a plain cut of
 * meat, poultry or fish (s456 CS, 2026-11-12; Diego's word "Defaults ok": a weighed meat
 * line with no cooking word stays RAW and the card says so).
 *
 * WIRE: an optional field on every /api/nlp/parse item, one-shot and streamed alike.
 * OMITTED (never null) whenever this returns null, so every other item stays
 * byte-identical. Values:
 *   'cooked'      the RESOLVED RECORD's name states a cooking word ("Grilled Chicken",
 *                 "Beef Chuck (..., Cooked, Braised)"), or the name is silent and an
 *                 UNBRANDED FatSecret panel clears the raw ceiling (THE PANEL GUARD below).
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
 * makes NO claim from its name: FatSecret's generic "Chicken Breast" (fs_1641) bills 195
 * kcal/100 g and "Chicken Thigh" (fs_1695) 245 — cooked-basis panels under raw-sounding
 * names (MEL 30-day medians, measured 2026-11-12). Since s457 P1 THE PANEL GUARD below
 * calls such an unbranded FatSecret record 'cooked' once its panel clears the raw ceiling;
 * every other silent FatSecret / FDC / AI record still makes no claim, which is always
 * safe. A silent OFF record on a
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
 *
 * THE PANEL GUARD (s457 P1). A silent name is not the whole story: the record's own
 * kcal/100 g can rule raw out. RAW_MAX_KCAL holds, per whole-muscle cut, the highest
 * kcal/100 g any RAW form of that cut reaches in USDA SR Legacy (max over skin-on /
 * skinless and lean / lean-and-fat variants; fdcId on each row). Above it:
 *   - a silent Open Food Facts record is NOT called raw (field omitted) once the panel is
 *     more than OFF_OMIT_MARGIN over the ceiling. Retail labels run above USDA (a raw
 *     drumstick label reads 179 against USDA's 161), so the margin is wide; omitting is
 *     always safe. Members it was cut for: Epic "Venison" 351, "Beef Cutlet" 290,
 *     Plainville "Turkey Breast" 205. A smoked brisket at 306 is NOT caught: raw retail
 *     brisket labels reach 310-353, so no kcal ceiling separates it.
 *   - a silent, UNBRANDED FatSecret record is 'cooked' once the panel is more than
 *     FS_COOKED_MARGIN over the ceiling. FatSecret's generic plain cuts are as-eaten
 *     values ("Chicken Thigh" 245 against raw 221 / roasted 232; "Chicken Breast" 195
 *     against raw 172 / roasted 197), so the label then describes the number billed. A
 *     branded FatSecret record is a retail label (Kirkland "Ribeye Steak" 332 is raw) and
 *     still makes no claim. Never re-picks a record, never changes the billed number.
 * Out of the guard (unchanged behaviour): names with a fat-ratio word (ground, minced,
 * lean, fat) because fat, not cooking, sets their kcal; belly, skin and wings (retail raw
 * wing labels run 223-290 against USDA's 191); lamb, veal,
 * bison and duck (USDA ranges too wide); fish and shellfish (raw and cooked sit inside
 * label noise: USDA raw shrimp 85 vs cooked 99-119, while OFF shrimp labels run to 119).
 * A record whose NAME says raw is never second-guessed by its panel.
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
    /** The billed panel's kcal per 100 g (the route's merged `nutritionPer100g.kcal100`). */
    kcal100?: number | null;
    /** The resolved record's brand (`mapped.brandName`); null/blank = a generic record. */
    brandName?: string | null;
}): CookingState | null {
    const name = fold(input.foodName);
    const head = name.replace(/\([^)]*\)/g, ' ').split(',')[0];
    const tokens = head.split(/[^a-z]+/).filter(Boolean);
    if (!tokens.some(t => FAMILY.has(t))) return null;
    if (!tokens.every(t => FAMILY.has(t) || CUT.has(t) || STATE.has(t))) return null;

    const recordRaw = RAW_WORD_RE.test(name);
    if (!recordRaw && COOKED_WORD_RE.test(name)) return 'cooked';
    const ceiling = recordRaw ? null : rawMaxKcalFor(name, tokens);
    const kcal = input.kcal100;
    if (ceiling != null && kcal != null && Number.isFinite(kcal)) {
        if (input.source === 'fatsecret' && !input.brandName?.trim() && kcal > ceiling * FS_COOKED_MARGIN) return 'cooked';
        if (input.source === 'openfoodfacts' && kcal > ceiling * OFF_OMIT_MARGIN) return null;
    }
    if (!recordRaw && input.source !== 'openfoodfacts') return null;
    const line = fold(input.rawText);
    if (!recordRaw && LINE_PACKAGED_RE.test(line)) return null;
    return RAW_WORD_RE.test(line) ? 'raw' : 'raw_default';
}

/** s457 P1: a silent unbranded FatSecret plain cut above ceiling x this is 'cooked'. */
export const FS_COOKED_MARGIN = 1.08;
/** s457 P1: a silent Open Food Facts plain cut above ceiling x this makes no raw claim. */
export const OFF_OMIT_MARGIN = 1.25;

/**
 * Any of these anywhere in the name (parentheses included) puts the record outside the panel guard.
 * `skin` is tested on the HEAD only: "Chicken Skin" and "Skin-on Thighs" are out, while FatSecret's
 * "Chicken Thigh (Skin Eaten)" is the same as-eaten generic as "Chicken Thigh" and stays in.
 */
const NO_BAND = new Set(['ground', 'minced', 'mince', 'lean', 'fat', 'belly', 'wing', 'wings']);

/**
 * [family words (any), cut words (any; [] = the family alone), USDA SR Legacy raw max kcal/100 g].
 * First matching row wins, so a cut row precedes its family's catch-all. A FAMILY with no row here
 * (lamb, veal, bison, duck, every fish and shellfish) is outside the guard by construction.
 */
const RAW_MAX_KCAL: readonly (readonly [readonly string[], readonly string[], number])[] = [
    [['chicken'], ['breast', 'breasts', 'tenderloin', 'tenderloins'], 172], // 171474 breast, meat and skin, raw
    [['chicken'], ['thigh', 'thighs'], 221], // 172385 thigh, meat and skin, raw
    [['chicken'], ['drumstick', 'drumsticks'], 161], // 172373 drumstick, meat and skin, raw
    [['chicken'], ['leg', 'legs', 'quarter', 'quarters'], 214], // 172378 leg, meat and skin, raw
    [['chicken'], [], 215], // 171447 broilers or fryers, meat and skin, raw
    [['turkey'], ['breast', 'breasts', 'tenderloin', 'tenderloins'], 157], // 171093 all classes, breast, meat and skin, raw
    [['turkey'], ['thigh', 'thighs'], 161], // 171533 retail parts, thigh, meat and skin, raw
    [['turkey'], ['leg', 'legs', 'drumstick', 'drumsticks'], 144], // 171493 all classes, leg, meat and skin, raw
    [['turkey'], [], 159], // 172870 whole, meat and skin, with added solution, raw
    [['beef', 'steak', 'steaks'], ['flank'], 165], // 169433 flank steak, lean and fat, 0" fat, choice, raw
    [['beef', 'steak', 'steaks'], ['round', 'cutlet', 'cutlets'], 199], // 169527 tip round, lean and fat, 1/8" fat, choice, raw
    [['beef', 'steak', 'steaks', 'sirloin', 'ribeye', 'chuck', 'brisket'], [], 367], // 168685 rib large end, lean and fat, prime, raw
    [['pork'], ['chop', 'chops', 'loin', 'tenderloin', 'tenderloins'], 211], // 167889 center rib chops, boneless, lean and fat, raw (tenderloin's own 120, 168312, sits under retail labels of 150-190)
    [['pork'], [], 277], // 167853 spareribs, lean and fat, raw
    [['venison'], [], 120], // 173855 Game meat, deer, raw (FDC API; not in the box's FdcFood subset)
];

/** The USDA raw ceiling for a silent plain-cut name, or null when the name is outside the guard. */
export function rawMaxKcalFor(foldedName: string, headTokens: string[]): number | null {
    if (foldedName.split(/[^a-z]+/).some(t => NO_BAND.has(t)) || headTokens.includes('skin')) return null;
    for (const [family, cut, max] of RAW_MAX_KCAL) {
        if (!headTokens.some(t => family.includes(t))) continue;
        if (cut.length === 0 || headTokens.some(t => cut.includes(t))) return max;
    }
    return null;
}
