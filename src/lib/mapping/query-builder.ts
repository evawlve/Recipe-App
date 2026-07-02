/**
 * Query Builder Module
 * 
 * Generates progressive search query candidates from strict → loose.
 * Uses the parsed ingredient name (with prep phrases stripped) for clean searches.
 */

import type { ParsedIngredient } from '../parse/ingredient-line';
import { getModifierSynonyms, detectDietaryModifiers } from '../parse/dietary-modifiers';

// ============================================================
// Types
// ============================================================

export interface QueryCandidate {
    query: string;
    specificity: 'high' | 'medium' | 'low';
    source: 'core' | 'simplified' | 'fallback' | 'synonym';
}

// ============================================================
// Main Query Builder
// ============================================================

/**
 * Build progressive search query candidates from strict → loose
 * 
 * @param parsed - Parsed ingredient (with prepPhrases already separated)
 * @param normalizedName - AI-normalized name (may have additional cleanup)
 * @returns Array of query candidates ordered from most specific to least
 */
export function buildQueryCandidates(
    parsed: ParsedIngredient | null,
    normalizedName: string
): QueryCandidate[] {
    const queries: QueryCandidate[] = [];
    const seen = new Set<string>();

    const addQuery = (query: string, specificity: QueryCandidate['specificity'], source: QueryCandidate['source']) => {
        const normalized = query.toLowerCase().trim();
        if (normalized && normalized.length > 1 && !seen.has(normalized)) {
            seen.add(normalized);
            queries.push({ query: normalized, specificity, source });
        }
    };

    // Q1: Core ingredient with qualifiers (most specific)
    // "fat free cottage cheese" or "boneless skinless chicken breast"
    if (parsed) {
        const coreQuery = buildCoreQuery(parsed, { includeQualifiers: true });
        if (coreQuery) {
            addQuery(coreQuery, 'high', 'core');
        }
    }

    // Q2: Normalized name (AI cleaned version)
    // May be same as core query, will be deduplicated
    if (normalizedName) {
        addQuery(normalizedName, 'high', 'core');
    }

    // Q3: Core ingredient without qualifiers (broader match)
    // "cottage cheese" instead of "fat free cottage cheese"
    if (parsed) {
        const simpleQuery = buildCoreQuery(parsed, { includeQualifiers: false });
        if (simpleQuery) {
            addQuery(simpleQuery, 'medium', 'simplified');
        }
    }

    // Q4: Main noun only (fallback for specialty items)
    // "cheese" from "cottage cheese"
    if (parsed?.name) {
        const mainNoun = extractMainNoun(parsed.name);
        if (mainNoun && mainNoun !== parsed.name.toLowerCase()) {
            addQuery(mainNoun, 'low', 'fallback');
        }
    }

    // Q5: Add dietary modifier synonyms for broader coverage
    // e.g., "fat free" → also search "nonfat"
    if (parsed?.name || normalizedName) {
        const text = parsed?.name || normalizedName;
        const modifiers = detectDietaryModifiers(text);

        for (const mod of modifiers.all.slice(0, 2)) {  // Limit to first 2 modifiers
            const synonyms = getModifierSynonyms(mod);
            for (const syn of synonyms.slice(0, 2)) {  // Limit to 2 synonyms per modifier
                const synQuery = text.toLowerCase().replace(mod, syn);
                if (synQuery !== text.toLowerCase()) {
                    addQuery(synQuery, 'medium', 'synonym');
                }
            }
        }
    }

    return queries.slice(0, 5);  // Max 5 queries
}

// ============================================================
// Helper Functions
// ============================================================

interface BuildCoreQueryOptions {
    includeQualifiers: boolean;
}

/**
 * Build a core query from parsed ingredient
 * 
 * @param parsed - Parsed ingredient
 * @param options - Whether to include qualifiers
 * @returns Query string
 */
function buildCoreQuery(
    parsed: ParsedIngredient,
    options: BuildCoreQueryOptions
): string | null {
    if (!parsed.name) return null;

    const parts: string[] = [];

    // Add qualifiers if requested (these are things like "boneless", "fresh", not prep phrases)
    if (options.includeQualifiers && parsed.qualifiers?.length) {
        // Filter to dietary-relevant qualifiers only
        const relevantQualifiers = parsed.qualifiers.filter(q =>
            isDietaryRelevantQualifier(q)
        );
        parts.push(...relevantQualifiers);
    }

    // Add the core name
    parts.push(parsed.name);

    // Add unit hint if present (e.g., "egg yolk" → include "yolk")
    if (parsed.unitHint && !parsed.name.includes(parsed.unitHint)) {
        parts.push(parsed.unitHint);
        // Also add plural form
        if (!parsed.unitHint.endsWith('s')) {
            parts.push(parsed.unitHint + 's');
        }
    }

    return parts.join(' ').toLowerCase().trim() || null;
}

/**
 * Check if a qualifier is relevant for nutrition search
 * (vs. prep instructions like "chopped" which don't affect nutrition)
 */
function isDietaryRelevantQualifier(qualifier: string): boolean {
    const lower = qualifier.toLowerCase();

    // Size qualifiers affect nutrition
    if (['large', 'medium', 'small', 'extra large', 'jumbo'].includes(lower)) {
        return true;
    }

    // Meat qualifiers affect nutrition
    if (['boneless', 'skinless', 'bone-in', 'skin-on', 'lean', 'extra lean'].includes(lower)) {
        return true;
    }

    // Freshness can affect nutrition (dried vs fresh)
    if (['fresh', 'dried', 'frozen', 'canned'].includes(lower)) {
        return true;
    }

    // Prep qualifiers don't affect nutrition search
    if (['chopped', 'diced', 'minced', 'sliced', 'grated', 'shredded', 'packed'].includes(lower)) {
        return false;
    }

    return false;
}

/**
 * Extract the main noun from an ingredient name
 * Useful for fallback searches when specific item not found
 * 
 * "cottage cheese" → "cheese"
 * "chicken breast" → "chicken"
 */
function extractMainNoun(name: string): string | null {
    const tokens = name.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    if (tokens.length === 0) return null;
    if (tokens.length === 1) return tokens[0];

    // Common patterns where first word is the main noun
    const mainNounFirst = ['chicken', 'beef', 'pork', 'lamb', 'turkey', 'fish', 'salmon', 'tuna'];
    if (mainNounFirst.includes(tokens[0])) {
        return tokens[0];
    }

    // Common patterns where last word is the main noun
    const modifierPatterns = [
        'cottage', 'cream', 'cheddar', 'mozzarella', 'parmesan', 'swiss',
        'olive', 'vegetable', 'coconut', 'almond', 'peanut',
        'brown', 'white', 'whole', 'all purpose',
    ];

    if (modifierPatterns.includes(tokens[0])) {
        return tokens[tokens.length - 1];
    }

    // Default: return last word (often the main noun)
    return tokens[tokens.length - 1];
}

// ============================================================
// Export for Testing
// ============================================================

export { buildCoreQuery, isDietaryRelevantQualifier, extractMainNoun };
