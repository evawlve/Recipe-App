/**
 * scoop-powder-repick.ts — on a SCOOP line, a ready-to-drink record that won
 * the rerank gives its seat to a powder record of the SAME product when one
 * is in the scored pool (s459 SCOOP-PICK).
 *
 * THE DEFECT. Nothing on the cold path reads the unit when it ranks, so a
 * scoop line ranks the bottle and the tub alike, and the bottle often wins on
 * name coverage or by the id seat: `1 scoop muscle milk chocolate` picks the
 * carton `Muscle Milk PRO33g - Chocolate` (61.5 kcal/100 g) and bills a 35 g
 * scoop of it at 21.5 kcal, while Muscle Milk's own `Chocolate Protein
 * Powder` (386 kcal/100 g) sits in the same window. #696 (scoop-liquid-escape)
 * stops a CACHE READ from serving the drink; this is its cold-path twin.
 *
 * THE SHAPE: a RE-PICK inside one product, never a demotion into another
 * food (the LATTE-c shape). It acts only when ALL of these hold:
 *   - the raw line LEADS with a scoop measure (SCOOP_LEAD; `medida` too);
 *   - the rerank WINNER reads as a drink by name and panel
 *     (`isRtdByNameAndPanel()`: DRINK_NAME, the same name gate #696 uses, and
 *     a per-100 g panel under LIQUID_MAX_KCAL_PER_100G, and no frozen /
 *     spoonable food word — `Protein Ice Cream` is not a drink);
 *   - POOL GUARD: a candidate below it is a powder of the same product
 *     (`isPowderSiblingOf()`): a per-100 g panel inside the powder band
 *     [POWDER_MIN, POWDER_MAX] (the PANEL GUARD — a record with no panel is
 *     never moved, either way), a name that says drink or powder (a powdered
 *     drink, or a powder), no solid-food word (bar, cookie, cereal …), and
 *     its name + brand cover EVERY content token of the rerank query — so it
 *     is the asked product, not a neighbour that happens to be dense;
 *   - it is not floor-hit, does not leave the decisive-brand partition, and
 *     its own score keeps the rerank above MIN_RERANK_CONFIDENCE
 *     (SCOOP_POWDER_MIN_SCORE), so a re-pick can never strand the line.
 * Nothing else moves: when the winner is not a drink, or no sibling powder is
 * scored, the order is byte-identical. The re-pick is served and never saved
 * (SCOOP_POWDER_REPICK below; finalizeAndSaveResult()).
 *
 * WHY THIS IS NOT A LANE PREFERENCE (annex §Reading "Serving-class cache
 * keys…": "prefer the unit-carrying candidate degenerates into a lane
 * preference"). That trap is about SERVING RICHNESS, a property of the source
 * (OFF records carry one serving row, FatSecret many). This reads no serving
 * data at all: it reads the per-100 g panel and the record name, which every
 * lane carries alike, and it moves within one product named by the query's
 * own tokens. The replay's movers cross lanes in both directions (s459
 * pd-scoop findings).
 *
 * Kill-switch: RANK_SCOOP_POWDER="0" restores today's ordering.
 */

/**
 * The rerank reason a re-pick returns, and the save class it is refused under. The re-picked powder
 * is SERVED but never written back: the cache key carries no unit, so a powder saved by
 * `1 scoop chocolate shake` would be served to every later bare `chocolate shake` (a milkshake) —
 * the key capture #696 measured in the other direction (s459 pd-key C04/C05). The scoop line
 * re-resolves cold instead, as #696's escaped lines do.
 */
export const SCOOP_POWDER_REPICK = 'scoop_powder_repick';

/**
 * A raw line whose LEADING measure is a scoop: `1 scoop …`, `2 scoops …`, `.7 scoop of …`, `a scoop of …`,
 * `half a scoop of …`, `scoop of …`, `dos scoops de …`, `una medida de …`. Reads the RAW line, because the
 * rerank query carries no unit. The LEAD position is the point: it is where the parser reads a unit, so the
 * re-picked powder is billed as scoops. A trailing scoop (`protein shake (1 scoop) w/ water`, `vega sport
 * protein one scoop`) parses with no unit, and a powder picked for it falls to the 100 g floor — 400 kcal
 * against a 120 kcal scoop (s459 pd-scoop replay r1). `una medida de …` / `2 medidas …` (the Spanish supplement scoop) are the one EXCEPTION:
 * the parser does NOT read `medida` as a unit while the medida alias is HELD, so a medida re-pick bills the
 * powder UNITLESS. It is kept because a unitless powder resolves a label serving there, not the floor: every
 * medida-led powder event in MappingEventLog (25 events, 6 line x record pairs, 19–76 g, measured 2026-11-16)
 * and both medida re-picks in the s459 replays (36 g, 40 g). A powder with no label or sibling serving would
 * bill 100 g (s459 rf-scoop finding 6).
 */
const SCOOP_LEAD = /^\s*(?:(?:\d+(?:[.,]\d+)?|\.\d+|\d+\s*\/\s*\d+|a|an|one|two|three|four|half(?:\s+an?)?|una?|uno|dos|tres|media)\s+)?(?:(?:heaping|heaped|level|rounded|full|big|small)\s+)?(?:scoops?|scoopfuls?|medidas?)(?![a-z\u00e0-\u00ff])/i;

/** Same name gate as #696's `looksReadyToDrink()` (scoop-liquid-escape.ts DRINK_NAME). */
const DRINK_NAME = /(?<![a-z])(?:protein|shakes?|drinks?|milk|smoothies?|beverages?|juice)(?![a-z])/i;

/** A drink-named record that is really a spoonable or frozen food. */
const NOT_A_DRINK = /(?<![a-z])(?:ice\s*cream|frozen|gelato|sorbet|sherbet|pudding|yog(?:h)?urt|custard|mousse|cheese|bars?|cookies?)(?![a-z])/i;

/** A record named as a powder. */
const POWDER_NAME = /(?<![a-z])(?:powders?|powdered|whey|isolate|casein|mix|formula)(?![a-z])/i;

/**
 * A dense record that is a solid food or a dense liquid, not a powder ("lean muscle minis bars", "milk
 * chocolate"). `protein` is a drink word, so every `Protein <solid>` record passes the name test: the
 * deploy-42 pools hold Protein Puffs 380, Protein Pasta 321, Protein Balls 387, protein rolled oats 380,
 * Protein pancake mix 370, Protein Donut 278, Smoothie bowl 467 and chocolate syrup 279, all in the powder
 * band (s459 rf-scoop). On a bare `1 scoop protein` the first of them in score order would take the seat.
 */
const SOLID_FOOD = /(?<![a-z])(?:bars?|cookies?|cereal|crisps?|chips?|wafers?|bites|candy|cake|brownies?|crackers?|granola|muffins?|minis|milk\s+chocolate|puffs?|pasta|penne|noodles?|balls?|donuts?|doughnuts?|oats|pancakes?|waffles?|bread|pretzels?|popcorn|jerky|bowls?|syrup|condensed|evaporated)(?![a-z])/i;

/** A ready-to-drink panel is never this dense; RTD shakes and milks sit at 30–100 kcal/100 g. */
export const LIQUID_MAX_KCAL_PER_100G = 150;

/** Powder band: protein / meal / milk / cocoa powders sit at 330–500; chocolate and nut butters (≥ 530) stay out. */
export const POWDER_MIN_KCAL_PER_100G = 250;
export const POWDER_MAX_KCAL_PER_100G = 520;

/** simpleRerank's confidence is 0.5 + score/2; a sibling under 0.40 would be refused at MIN_RERANK_CONFIDENCE 0.70. */
export const SCOOP_POWDER_MIN_SCORE = 0.40;

/** Words of the query that name the measure, not the product. */
const MEASURE_TOKENS = new Set(['scoop', 'scoops', 'scoopful', 'scoopfuls', 'serving', 'servings', 'of', 'a', 'an', 'one', 'half']);

export interface ScoopRecord {
    name: string;
    brandName?: string;
    nutrition?: { kcal: number; per100g: boolean };
}

export function isScoopLine(rawLine: string | null | undefined): boolean {
    return typeof rawLine === 'string' && SCOOP_LEAD.test(rawLine);
}

function per100Kcal(rec: ScoopRecord): number | null {
    const n = rec.nutrition;
    if (!n || n.per100g !== true || n.kcal == null || !Number.isFinite(n.kcal)) return null;
    return n.kcal;
}

/** True when the record reads as a ready-to-drink liquid from its name and per-100 g panel alone. */
export function isRtdByNameAndPanel(rec: ScoopRecord): boolean {
    const kcal = per100Kcal(rec);
    if (kcal == null || kcal >= LIQUID_MAX_KCAL_PER_100G) return false;
    return DRINK_NAME.test(rec.name) && !NOT_A_DRINK.test(rec.name) && !POWDER_NAME.test(rec.name);
}

function contentTokens(text: string): string[] {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
        .filter(t => t.length > 1 && !MEASURE_TOKENS.has(t));
}

function fold(t: string): string {
    return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

/**
 * True when `rec` is a powder of the product the query names: powder-band
 * panel, named as a drink or a powder, not a solid food, and its name + brand
 * cover every content token of the rerank query.
 */
export function isPowderSiblingOf(rec: ScoopRecord, query: string): boolean {
    const kcal = per100Kcal(rec);
    if (kcal == null || kcal < POWDER_MIN_KCAL_PER_100G || kcal > POWDER_MAX_KCAL_PER_100G) return false;
    if (SOLID_FOOD.test(rec.name) || NOT_A_DRINK.test(rec.name)) return false;
    if (!DRINK_NAME.test(rec.name) && !POWDER_NAME.test(rec.name)) return false;
    const queryTokens = contentTokens(query).map(fold);
    if (queryTokens.length === 0) return false;
    const have = new Set(contentTokens(`${rec.name} ${rec.brandName ?? ''}`).map(fold));
    return queryTokens.every(t => have.has(t));
}

/**
 * The index of the candidate that takes the winner's seat, or -1.
 * `ranked` is simpleRerank's sorted list (best first).
 */
export function findScoopPowderRepick<T extends { candidate: ScoopRecord; score: number; plausibilityFloorHit: boolean; decisiveBrandBoost: number }>(
    ranked: T[],
    query: string,
    rawLine: string | null | undefined,
): number {
    if (process.env.RANK_SCOOP_POWDER === '0') return -1;
    if (ranked.length < 2 || !isScoopLine(rawLine)) return -1;
    const top = ranked[0];
    if (!isRtdByNameAndPanel(top.candidate)) return -1;
    for (let i = 1; i < ranked.length; i++) {
        const s = ranked[i];
        if (s.plausibilityFloorHit) continue;
        if (top.decisiveBrandBoost > 0 && !(s.decisiveBrandBoost > 0)) continue;
        if (s.score < SCOOP_POWDER_MIN_SCORE) continue;
        if (isPowderSiblingOf(s.candidate, query)) return i;
    }
    return -1;
}
