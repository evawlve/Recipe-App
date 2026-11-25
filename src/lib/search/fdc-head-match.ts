/**
 * Whether a USDA description NAMES the queried food, judged on its head: the text
 * before the first ", ". USDA writes the food first and its qualifiers after
 * ("Raspberries, raw"), so the head is the food itself:
 *   raspberry  ~ "Raspberries, raw"             -> true
 *   raspberry  ~ "Raspberry juice concentrate"  -> false (head is a juice)
 *   strawberry ~ "Guavas, strawberry, raw"      -> false (head is guavas)
 * Tokens compare through `coverageTokens()`, so plurals and punctuation do not
 * matter, and the two token SETS must be equal and non-empty.
 *
 * Used by /api/foods/search to order two hoisted produce rows: a row whose head
 * is the query sorts before one that only mentions it.
 */

import { coverageTokens } from './query-token-coverage';

export function fdcHeadMatchesQuery(query: string, description: unknown): boolean {
    if (typeof description !== 'string') return false;
    const commaAt = description.indexOf(', ');
    const head = commaAt === -1 ? description : description.slice(0, commaAt);
    const headTokens = new Set(coverageTokens(head));
    const queryTokens = new Set(coverageTokens(query));
    if (headTokens.size === 0 || headTokens.size !== queryTokens.size) return false;
    for (const t of queryTokens) {
        if (!headTokens.has(t)) return false;
    }
    return true;
}
