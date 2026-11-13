/**
 * `homemade` is a preparation descriptor, not an identity (S202, row 7(1a)).
 *
 * Mechanism (measured by S202): the brand lexicon carried a `homemade` entry
 * (an OFF brand string) and the brand detector therefore flagged any line
 * containing it as BRANDED, which made `homemade` a required identity token —
 * so "homemade fried rice" resolved to a product branded "Homemade" rather than
 * to fried rice.
 *
 * S202 design: strip `homemade` / `home made` / `home-made` (and a trailing
 * `style`) from the base name so that "homemade X" maps like "X". The lexicon
 * entry is also removed (and stop-listed in build-brand-lexicon.ts).
 *
 * Exemption rule: when a brand or a person owns the word the descriptor stays
 * ("rao's homemade marinara", "mom's homemade mac and cheese", "blue bell
 * homemade vanilla") — there `homemade` is part of a name, not a description.
 * Concretely: the brand contains home[ -]?made, OR the brand's last token equals
 * the word before `homemade` (with a trailing 's removed), OR that word ends in
 * 's (a possessive person).
 *
 * It runs LAST in preflightIngredientLine() so the retrieval query and the cache
 * key, both derived from the returned baseName, move together to the bare dish.
 *
 * Pure: no I/O. The caller supplies the brand
 * (`options.brand?.trim() || detectBrandInQuery(rawLine).matchedBrand`).
 */

const HM = /\bhome(?:made|[ -]made(?!\s+(?:with|by|from|in|at|it)\b))(?:[ -]style)?\b/i;

export function stripHomemadeDescriptor(
    baseName: string,
    rawLine: string,
    brand: string | null | undefined,
): { baseName: string; stripped: boolean; reason?: string } {
    if (!HM.test(baseName)) return { baseName, stripped: false };
    const b = (brand ?? '').toLowerCase();
    const raw = rawLine.toLowerCase();
    const m = raw.match(/([\w'’]+)\s+home(?:made|[ -]made)\b/);
    const prev = m ? m[1] : '';
    const brandOwns = (!!b && /home[ -]?made/.test(b))
        || (!!b && !!prev && b.split(/\s+/).pop() === prev.replace(/['’]s$/, ''))
        || (!!b && !!prev && b.split(/\s+/).pop() === prev)
        || /['’]s$/.test(prev);
    if (brandOwns) return { baseName, stripped: false, reason: 'brand-owns' };
    const out = baseName.replace(new RegExp(HM.source, 'gi'), ' ').replace(/\s+/g, ' ').trim();
    if (!out) return { baseName, stripped: false };
    return { baseName: out, stripped: true };
}
