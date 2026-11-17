/**
 * Spanish staple names -> their English form, before retrieval, the cache keys and the LLM stages
 * (s459 ES-BARE-STAPLE; MEDIA-LUNA is one member).
 *
 * MECHANISM. Retrieval is name-based against a corpus indexed in English, and the US OFF ingest
 * carries Spanish product names. A Spanish staple that reaches retrieval UNTRANSLATED therefore wins
 * a same-named branded record instead of the food:
 *   media luna  -> OFF "Luna" (a LUNA bar, 48 g / 188 kcal); the whole pool is Luna products
 *   sal         -> OFF "Manteiga com Sal" (salted butter, 74 kcal)
 *   cafe        -> OFF "Cafe" (462 kcal/100 g)
 *   cerveza     -> OFF "Cerveza" (8.5 kcal/100 g, 30 kcal a can)
 *   vino tinto  -> OFF "Spanish Style Chorizo al Vino Tinto" (379 kcal)
 * It reaches retrieval untranslated by two routes, and the normalize LLM cannot close either:
 *   1. isSpanishLine() is FALSE, so the line never gets the Spanish prompt: `media luna` (a WEAK
 *      marker and a noun outside its lexicon), bare SHARED nouns `sal` / `cafe` (deliberately never
 *      Spanish alone: they are English menu words), `vino tinto` (no marker). The English prompt keeps
 *      the name (AiNormalizeCache `media luna` -> `media luna`) or the gate skips the model because
 *      the quick gather found the same-named record.
 *   2. isSpanishLine() is TRUE and the Spanish prompt still keeps the Spanish noun as
 *      `normalized_name` (AiNormalizeCache `ES:cerveza` -> `cerveza`, `ES:una cerveza` -> `cerveza`).
 * So this is deterministic, like rewriteRegionalDishWords(): a closed table, applied at that function's
 * seats (preflight parsed.name, normalizeIngredientName(), the normalize and simplify LLM inputs) plus
 * baseName in mapIngredientWithFallback() (the segmenter's normalizedForm). It MOVES keys (FoodMapping
 * and AiNormalizeCache `media luna` -> `croissant`) and needs no RULES_VERSION bump: nothing stale sits
 * at a new key (the C70 row 4 precedent in validated-mapping-helpers.ts).
 *
 * TWO TIERS, both accent-folded and case-insensitive:
 *   - WHOLE NAMES: rewritten only when the whole name is the word, optionally after one Spanish
 *     article (`una cerveza` -> `beer`). `sal`, `cafe`, `vino` are also English menu words, so a
 *     longer name (`cafe latte`, `cafe con leche`, `chorizo al vino tinto`) is never touched.
 *   - PHRASES: `media luna` / `medialuna` and plurals have no English reading at all, so they are
 *     rewritten wherever they stand (`media luna de chocolate` -> `croissant de chocolate`); a
 *     leading article before one is dropped. detectBrandInQuery() scans the line through
 *     maskSpanishStaplePhrases(), so `luna` inside the phrase is not the Luna Bar brand; `luna bar`,
 *     `luna protein bar` and bare `luna` contain no phrase and keep the brand.
 *     Known residual (s459 rf-staple): a longer name becomes code-mixed (`media luna de jamon y queso`
 *     -> `croissant de jamon y queso`) and the English normalize keeps it, so it can still miss the
 *     ham-and-cheese croissant; on the route it was a Luna bar before (measured), so it is not worse.
 *
 * Pure and idempotent (no output is an input). Text with no match is returned byte-identical.
 * Deliberately NOT here, each measured cold on deploy 44 (s459 pd-luna): `pan` / `un pan` (a "Pan"
 * bread record, 375 kcal/100 g: the right food), `te` / `un te` (a Tea record), `cuernito` (also a
 * pasta and a pork-rind word in Mexico), `corona` (a brand, served warm as Corona Extra).
 * The class is sized (s459 rf-staple, 102 Spanish staples): 45 reach retrieval untranslated, and all
 * but the table's members resolve to the right food through a Spanish-labelled US record (`queso`,
 * `jamon`, `helado`, `tocino`, `elote`, ...), so translating them would move right answers. Seen and
 * NOT added: `dulce` (ambiguous: sweet / candy / dulce de leche; today a 1 kg 3,214 kcal record);
 * `ron` (today "Rons" 286 kcal, but English `rum` itself resolves to a rum cake, 398 kcal: not better).
 */

/** Whole-name table: folded lowercase Spanish name -> English name. */
export const SPANISH_STAPLE_WHOLE_NAMES: Readonly<Record<string, string>> = {
    'sal': 'salt',
    'cafe': 'coffee',
    'cerveza': 'beer',
    'cervezas': 'beers',
    'vino': 'wine',
    'vinos': 'wine',      // not `wines`: that retrieves a red-wines simmer sauce (s459 rf-staple)
    'vino tinto': 'red wine',
    'vino blanco': 'white wine',
    'vino rosado': 'rose wine',
    // s459 rf-staple: the same mechanism, measured on a 102-word staple vocabulary (Mac full-mapper
    // replay, cold, stack 8426e9d9): each one's same-named US record is a DIFFERENT food today.
    'pina': 'pineapple',     // FS "Pina Colada" 133 g / 230 kcal
    'papa': 'potato',        // OFF "Papas" chips, 100 g / 606 kcal
    'te verde': 'green tea', // OFF "VERDE" 100 g / 21 kcal
};

const ARTICLE = '(?:(?:un|una|unos|unas|el|la|los|las)\\s+)?';
const wholeKeys = Object.keys(SPANISH_STAPLE_WHOLE_NAMES)
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/ /g, '\\s+'))
    .join('|');
const WHOLE_NAME = new RegExp(`^\\s*${ARTICLE}(${wholeKeys})\\s*$`, 'i');
/** The phrase tier: `media luna` / `medias lunas` / `medialuna(s)` (and `media-luna`) -> croissant(s), plural by the `luna` token. */
const PHRASE = /\b(?:medias?[\s-]+lunas?|medialunas?)\b/i;
const PHRASE_ALL = /\b(?:medias?[\s-]+(lunas?)|media(lunas?))\b/gi;
const LEADING_ARTICLE_BEFORE_PHRASE = /^\s*(?:un|una|unos|unas)\s+(?=(?:medias?[\s-]+lunas?|medialunas?)\b)/i;

function fold(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * The PHRASE tier alone, on raw text (no fold, no article drop): what detectBrandInQuery() scans, so
 * `luna` inside `media luna` is never read as the Luna Bar brand. Without it the brand survives the
 * rewrite: on the segmenter path preserveDroppedBrand() prepends it (`luna croissant` -> a Luna bar,
 * measured in the s459 pd-luna replay), and every path hands it to rerank as targetBrand.
 */
export function maskSpanishStaplePhrases(text: string): string {
    if (!text || !PHRASE.test(text)) return text;
    return text.replace(PHRASE_ALL, (_m: string, a?: string, b?: string) =>
        ((a ?? b ?? '').toLowerCase().endsWith('s') ? 'croissants' : 'croissant'));
}

/** The rewrite. See the module header for the tiers, the measured members and the exclusions. */
export function rewriteSpanishStapleNames(text: string): string {
    if (!text) return text;
    const folded = fold(text);
    const whole = folded.match(WHOLE_NAME);
    if (whole) {
        const english = SPANISH_STAPLE_WHOLE_NAMES[whole[1].toLowerCase().replace(/\s+/g, ' ')];
        if (english) return english;
    }
    if (!PHRASE.test(folded)) return text;
    return folded
        .replace(LEADING_ARTICLE_BEFORE_PHRASE, '')
        .replace(PHRASE_ALL, (_m: string, a?: string, b?: string) =>
            ((a ?? b ?? '').toLowerCase().endsWith('s') ? 'croissants' : 'croissant'));
}
