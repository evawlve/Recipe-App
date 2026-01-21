/**
 * FDC Serving Enrichment
 * 
 * Step 6 of AI Cost Reduction Refactor:
 * Fetches household servings (small/medium/large, cups, tbsp) from USDA FDC
 * to fill serving gaps before resorting to LLM backfill.
 * 
 * Uses FDC food details endpoint to get foodPortions with householdServings.
 */

import { fdcApi } from '../usda/fdc-api';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export interface FdcServingOption {
    /** Human-readable label like "1 medium", "1 cup, chopped" */
    label: string;
    /** Weight in grams */
    grams: number;
    /** FDC ID of the source food */
    fdcId: number;
    /** Optional qualifiers like ["raw"], ["cooked"] */
    qualifiers?: string[];
    /** Serving unit (e.g., "cup", "medium", "tbsp") */
    unit?: string;
    /** Size qualifier (for produce) */
    size?: 'small' | 'medium' | 'large';
}

// ============================================================
// In-Memory Cache (24h TTL, 200 entries)
// ============================================================

interface CacheEntry {
    servings: FdcServingOption[];
    expiresAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_MAX_SIZE = 200;
const servingCache = new Map<string, CacheEntry>();

function getCached(canonicalBase: string): FdcServingOption[] | null {
    const entry = servingCache.get(canonicalBase.toLowerCase());
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
        servingCache.delete(canonicalBase.toLowerCase());
        return null;
    }
    return entry.servings;
}

function setCache(canonicalBase: string, servings: FdcServingOption[]): void {
    // Evict oldest if at capacity
    if (servingCache.size >= CACHE_MAX_SIZE) {
        const firstKey = servingCache.keys().next().value;
        if (firstKey) servingCache.delete(firstKey);
    }

    servingCache.set(canonicalBase.toLowerCase(), {
        servings,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

// ============================================================
// Serving Label Parsing
// ============================================================

/**
 * Parse a portion description to extract unit and size
 * @example "1 medium (2-3/4\" dia)" → { unit: "medium", size: "medium" }
 * @example "1 cup, chopped" → { unit: "cup", qualifiers: ["chopped"] }
 */
function parsePortionDescription(description: string): {
    unit?: string;
    size?: 'small' | 'medium' | 'large';
    qualifiers: string[];
} {
    const lower = description.toLowerCase();
    const qualifiers: string[] = [];
    let size: 'small' | 'medium' | 'large' | undefined;
    let unit: string | undefined;

    // Extract size
    if (lower.includes('small')) size = 'small';
    else if (lower.includes('medium')) size = 'medium';
    else if (lower.includes('large')) size = 'large';

    // Extract qualifiers
    const qualifierPatterns = ['chopped', 'sliced', 'diced', 'raw', 'cooked', 'mashed', 'pureed'];
    for (const q of qualifierPatterns) {
        if (lower.includes(q)) qualifiers.push(q);
    }

    // Extract unit
    const unitPatterns = [
        { pattern: /\bcup\b/i, unit: 'cup' },
        { pattern: /\btbsp\b|\btablespoon\b/i, unit: 'tbsp' },
        { pattern: /\btsp\b|\bteaspoon\b/i, unit: 'tsp' },
        { pattern: /\boz\b|\bounce\b/i, unit: 'oz' },
        { pattern: /\bslice\b/i, unit: 'slice' },
        { pattern: /\bpiece\b/i, unit: 'piece' },
        { pattern: /\bsmall\b/i, unit: 'small' },
        { pattern: /\bmedium\b/i, unit: 'medium' },
        { pattern: /\blarge\b/i, unit: 'large' },
    ];

    for (const { pattern, unit: u } of unitPatterns) {
        if (pattern.test(description)) {
            unit = u;
            break;
        }
    }

    return { unit, size, qualifiers };
}

// ============================================================
// Main Functions
// ============================================================

/**
 * Fetch household serving options from FDC for a canonical ingredient base.
 * Uses FDC search + details endpoint to extract portion measures.
 * Results are cached by canonicalBase (24h TTL).
 * 
 * @param canonicalBase - The canonical base name (e.g., "banana", "milk")
 * @returns Array of serving options with gram weights
 */
export async function fetchFdcServingOptions(
    canonicalBase: string
): Promise<FdcServingOption[]> {
    // Check cache first
    const cached = getCached(canonicalBase);
    if (cached !== null) {
        logger.debug('fdc-servings.cache_hit', { canonicalBase });
        return cached;
    }

    try {
        // Search for the ingredient
        const searchResult = await fdcApi.searchFoods({
            query: canonicalBase,
            pageSize: 5  // Get top 5 to find best match
        });

        if (!searchResult?.foods?.length) {
            setCache(canonicalBase, []);
            return [];
        }

        // Prefer Foundation or SR Legacy data types (more reliable serving info)
        const preferredFood = searchResult.foods.find(f =>
            f.dataType?.includes('Foundation') || f.dataType?.includes('SR Legacy')
        ) || searchResult.foods[0];

        // Get detailed food info with portions
        const details = await fdcApi.getFoodDetails(preferredFood.fdcId);

        if (!details?.foodPortions?.length) {
            setCache(canonicalBase, []);
            return [];
        }

        // Extract serving options from foodPortions
        const servings: FdcServingOption[] = [];

        for (const portion of details.foodPortions) {
            const gramWeight = portion.gramWeight;
            const portionDescription = portion.portionDescription ||
                portion.modifier ||
                portion.measureUnit?.name ||
                '';

            if (!gramWeight || gramWeight <= 0) continue;
            if (!portionDescription) continue;

            const parsed = parsePortionDescription(portionDescription);

            // Build label
            const amount = portion.amount || 1;
            const label = `${amount} ${portionDescription}`.trim();

            servings.push({
                label,
                grams: gramWeight,
                fdcId: preferredFood.fdcId,
                qualifiers: parsed.qualifiers.length > 0 ? parsed.qualifiers : undefined,
                unit: parsed.unit,
                size: parsed.size,
            });
        }

        logger.debug('fdc-servings.fetched', {
            canonicalBase,
            fdcId: preferredFood.fdcId,
            servingCount: servings.length,
        });

        setCache(canonicalBase, servings);
        return servings;

    } catch (err) {
        logger.warn('fdc-servings.fetch_error', {
            canonicalBase,
            error: (err as Error).message,
        });
        return [];
    }
}

/**
 * Find best matching FDC serving for a requested unit.
 * 
 * @param servings - Available FDC serving options
 * @param requestedUnit - The unit being searched for (e.g., "cup", "medium")
 * @param requestedSize - Optional size qualifier (small/medium/large)
 * @returns Matching serving or null
 */
export function matchFdcServing(
    servings: FdcServingOption[],
    requestedUnit: string,
    requestedSize?: 'small' | 'medium' | 'large'
): FdcServingOption | null {
    if (servings.length === 0) return null;

    const unitLower = requestedUnit.toLowerCase();

    // First pass: exact unit + size match
    if (requestedSize) {
        const exactMatch = servings.find(s =>
            s.unit === unitLower && s.size === requestedSize
        );
        if (exactMatch) return exactMatch;
    }

    // Second pass: exact unit match (any size)
    const unitMatch = servings.find(s => s.unit === unitLower);
    if (unitMatch) return unitMatch;

    // Third pass: unit in label
    const labelMatch = servings.find(s =>
        s.label.toLowerCase().includes(unitLower)
    );
    if (labelMatch) return labelMatch;

    // Fourth pass: size match (for produce)
    if (requestedSize) {
        const sizeMatch = servings.find(s => s.size === requestedSize);
        if (sizeMatch) return sizeMatch;
    }

    // Fifth pass: "medium" as default for produce
    if (['small', 'medium', 'large', 'each', 'whole'].includes(unitLower)) {
        const mediumMatch = servings.find(s => s.size === 'medium');
        if (mediumMatch) return mediumMatch;
    }

    return null;
}

/**
 * Try to get FDC serving weight for a given canonical base and unit.
 * Combines fetchFdcServingOptions and matchFdcServing.
 * 
 * @param canonicalBase - The canonical ingredient base
 * @param requestedUnit - The unit to look up
 * @param requestedSize - Optional size qualifier
 * @returns Gram weight if found, null otherwise
 */
export async function getFdcServingWeight(
    canonicalBase: string,
    requestedUnit: string,
    requestedSize?: 'small' | 'medium' | 'large'
): Promise<{ grams: number; label: string; source: 'fdc' } | null> {
    const servings = await fetchFdcServingOptions(canonicalBase);
    const match = matchFdcServing(servings, requestedUnit, requestedSize);

    if (match) {
        return {
            grams: match.grams,
            label: match.label,
            source: 'fdc',
        };
    }

    return null;
}
