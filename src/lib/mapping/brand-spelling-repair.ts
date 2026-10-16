/**
 * brand-spelling-repair.ts — A BRAND THE USER SPELLED ONE OR TWO LETTERS OFF.
 * Lane A S64 (pm110 ROW 2, 2026-10-01); called once, at the top of simpleRerank().
 *
 * THE DEFECT. Retrieval is typo-tolerant; the rerank is not. On build
 * `uttAaRkc31GfMo3L0d9fT` (measured from the box's mapping-analysis corpus, the
 * shipped function's own record):
 *   - `.7 scoop of ryze peanut butter`: retrieval ranks five RYSE records first
 *     (Ryse Peanut Butter Protein 2.8, then four "Loaded Protein … Peanut Butter"),
 *     and simpleRerank() picks FatSecret's generic `Peanut Butter` (fs_3384, 0.646)
 *     over Ryse Peanut Butter Protein (0.431). Same shape for `one scoop of ryze keep
 *     your peanut butter protein` (0.621 vs 0.531).
 *   - `10 pieces of Drizzliscious French toast`: retrieval ranks three Drizzilicious
 *     French Toast Bites records first (2.85, 2.85, 2.8); the rerank picks a bagel
 *     shop's "french toast" (0.616 vs 0.502), billed 700 g / 1,901 kcal.
 * computeSimpleScore() credits a brand only by exact substring
 * (`queryLower.includes(brandLower)`), and token overlap only by exact token, so the
 * user's spelling earns the right records nothing and the generic wins on length.
 *
 * THE RULE: score the line as the rerank WOULD have scored it had the user spelled
 * the brand the way a retrieved record does. A query token is rewritten to a brand
 * token only when ALL of these hold:
 *   1. it is an ORPHAN: no candidate's name or brand carries it (plural folded).
 *      This is what keeps `cheddar`, `peppers` and `queso` out — words a person
 *      spells right, which sit within two edits of the lexicon brands Cedar, Peters
 *      and Quest. The records they retrieve carry the word itself;
 *   2. it is not itself a lexicon brand (detectBrandInQuery()), so a real brand the
 *      user typed is never re-spelled into a neighbour (`kind` / `kinder`);
 *   3. it sits within retrieval's own typo budget of the brand of a candidate IN
 *      THIS POOL: 1 edit from 4 letters, 2 from 7 (Typesense's min_len_1typo /
 *      min_len_2typo defaults), the same first letter, Damerau distance (a
 *      transposition is one edit) — and neither spelling is a prefix of the other,
 *      because a changed ending is inflection, not a typo (`cooky` / Cook);
 *   4. that brand is ONE WORD and a lexicon brand — the spelling the brand detector
 *      would have recognised had the user typed it. A word inside a longer brand
 *      does not anchor (`Roca` is not Villa Roma Sausage Company, `queso` is not
 *      Quest Protein Chips);
 *   5. exactly ONE such brand is in the pool. Two near brands is ambiguity, and the
 *      line is left alone.
 *
 * FIRING POPULATION (measured 2026-10-01, the shipped function over the box's
 * mapping-analysis corpus: 390 files, 9,356 distinct (query, top-5 pool) decisions,
 * a LOWER bound because the corpus keeps 5 records of a 10-30 record pool). Before
 * clauses 3's prefix rule and 4's one-word rule: 10 fires, 7 true (`ryze` x4,
 * `drizzilicous`, `Drizzliscious`, `nutzo` -> Nuttzo) and 3 false (`queso` -> Quest,
 * `Roca` -> Roma, `cooky` -> Cook). With them: the 7 true, 0 false.
 * When it fires, simpleRerank() rewrites the token in its query and raw line, and
 * names the repaired brand as targetBrand when the caller named none or named the
 * misspelling (the segmenter's `brand` field carries the user's spelling: `Ryze`).
 * Nothing outside simpleRerank() sees the repair: the cache key, the save gate and
 * the logged normalizedForm keep the user's spelling. The repair is recorded on
 * `rerankOutcome.brandSpelling` in the mapping-analysis log.
 *
 * NOT IN SCOPE: a brand split or joined differently (`fair life` / `fairlife`), and a
 * misspelled brand whose records retrieval did not find — there is no pool anchor.
 */
import { detectBrandInQuery } from './brand-detector';

export interface BrandSpellingRepair {
    /** The user's token, lowercased. */
    from: string;
    /** The brand token of the anchoring record, lowercased. */
    to: string;
    /** The first candidate (in pool order) whose brand carries `to`. */
    anchorId: string;
}

/** Typesense's default typo thresholds: 1 edit from 4 letters, 2 from 7. */
const MIN_LEN_1_TYPO = 4;
const MIN_LEN_2_TYPOS = 7;

export function typoBudget(token: string): number {
    if (token.length >= MIN_LEN_2_TYPOS) return 2;
    if (token.length >= MIN_LEN_1_TYPO) return 1;
    return 0;
}

/** Optimal-string-alignment distance: insert, delete, substitute, adjacent transposition. */
export function damerauLevenshtein(a: string, b: string): number {
    const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
}

function words(text: string | null | undefined): string[] {
    return (text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function singular(token: string): string {
    return token.length > 3 && token.endsWith('s') && !token.endsWith('ss') ? token.slice(0, -1) : token;
}

/** The repair this pool licenses for this query, or null (see the header for the five conditions). */
export function findBrandSpellingRepair(
    query: string,
    candidates: ReadonlyArray<{ id: string; name: string; brandName?: string | null }>,
): BrandSpellingRepair | null {
    const vocabulary = new Set<string>();
    for (const c of candidates) {
        for (const w of [...words(c.name), ...words(c.brandName)]) vocabulary.add(singular(w));
    }
    for (const token of words(query)) {
        const budget = typoBudget(token);
        if (budget === 0 || !/^[a-z]+$/.test(token)) continue;
        if (vocabulary.has(singular(token))) continue;                     // 1. not an orphan
        if (detectBrandInQuery(token).isBranded) continue;                 // 2. a real brand the user typed
        const anchors = new Map<string, string>();
        for (const c of candidates) {
            const brandWords = words(c.brandName);
            if (brandWords.length !== 1) continue;                         // 4. a one-word brand
            const b = brandWords[0];
            if (b === token || b[0] !== token[0] || b.length < MIN_LEN_1_TYPO) continue;
            if (b.startsWith(token) || token.startsWith(b)) continue;      // 3. an ending is not a typo
            if (Math.abs(b.length - token.length) > budget) continue;
            if (damerauLevenshtein(token, b) > budget) continue;          // 3. within the typo budget
            if (!detectBrandInQuery(b).isBranded) continue;               // 4. a lexicon brand
            if (!anchors.has(b)) anchors.set(b, c.id);
        }
        if (anchors.size === 1) {                                          // 5. exactly one
            const [[to, anchorId]] = [...anchors];
            return { from: token, to, anchorId };
        }
    }
    return null;
}

/** Rewrite every whole-word occurrence of the repaired token, case-insensitively. */
export function applyBrandSpellingRepair(text: string, repair: BrandSpellingRepair): string {
    return text.replace(new RegExp(`\\b${repair.from}\\b`, 'gi'), repair.to);
}
