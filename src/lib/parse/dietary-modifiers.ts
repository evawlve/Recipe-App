/**
 * Dietary Modifiers Module
 * 
 * Centralized handling of dietary modifiers like "fat free", "low fat", 
 * "unsweetened", etc. Used for:
 * 1. Preserving modifiers during prep phrase stripping
 * 2. Search query expansion with synonyms
 * 3. Candidate scoring/filtering
 */

// ============================================================
// Modifier Definitions
// ============================================================

/**
 * Fat-related modifiers (mutually exclusive groups)
 */
export const FAT_FREE_MODIFIERS = [
    'fat free', 'fat-free', 'nonfat', 'non-fat', 'skim', '0% fat',
    'zero fat', 'no fat',
] as const;

export const REDUCED_FAT_MODIFIERS = [
    'reduced fat', 'low fat', 'lowfat', 'low-fat', 'lite', 'light',
    '2%', '1%', 'part skim', 'part-skim', 'less fat',
] as const;

export const WHOLE_FAT_MODIFIERS = [
    'whole', 'full fat', 'full-fat', 'regular', 'whole milk',
] as const;

/**
 * Sugar-related modifiers
 */
export const UNSWEETENED_MODIFIERS = [
    'unsweetened', 'no sugar', 'sugar free', 'sugar-free',
    'no added sugar', 'zero sugar', '0g sugar', 'sugarless',
] as const;

export const SWEETENED_MODIFIERS = [
    'sweetened', 'with sugar', 'sugared', 'honey sweetened',
    'lightly sweetened',
] as const;

/**
 * Sodium modifiers
 */
export const LOW_SODIUM_MODIFIERS = [
    'low sodium', 'reduced sodium', 'no salt', 'salt free',
    'salt-free', 'unsalted', 'no salt added',
] as const;

/**
 * Diet/health modifiers
 */
export const HEALTH_MODIFIERS = [
    'organic', 'natural', 'all natural', 'non-gmo',
    'gluten free', 'gluten-free', 'dairy free', 'dairy-free',
    'lactose free', 'lactose-free', 'vegan', 'vegetarian',
    'keto', 'paleo', 'whole grain', 'whole wheat',
    'multigrain', 'multi-grain', 'enriched', 'fortified',
    'raw', 'unprocessed',
] as const;

/**
 * All dietary modifiers combined
 */
export const ALL_DIETARY_MODIFIERS = [
    ...FAT_FREE_MODIFIERS,
    ...REDUCED_FAT_MODIFIERS,
    ...WHOLE_FAT_MODIFIERS,
    ...UNSWEETENED_MODIFIERS,
    ...SWEETENED_MODIFIERS,
    ...LOW_SODIUM_MODIFIERS,
    ...HEALTH_MODIFIERS,
] as const;

// ============================================================
// Modifier Detection
// ============================================================

export interface DetectedModifiers {
    fatFree: boolean;
    reducedFat: boolean;
    wholeFat: boolean;
    unsweetened: boolean;
    sweetened: boolean;
    lowSodium: boolean;
    health: string[];  // List of detected health modifiers
    all: string[];     // All detected modifiers
}

/**
 * Detect all dietary modifiers in text
 */
export function detectDietaryModifiers(text: string): DetectedModifiers {
    const lower = text.toLowerCase();
    const detected: string[] = [];
    const health: string[] = [];

    // Check each modifier group
    const fatFree = FAT_FREE_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    const reducedFat = REDUCED_FAT_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    const wholeFat = WHOLE_FAT_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    const unsweetened = UNSWEETENED_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    const sweetened = SWEETENED_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    const lowSodium = LOW_SODIUM_MODIFIERS.some(m => {
        if (lower.includes(m)) { detected.push(m); return true; }
        return false;
    });

    // Collect all health modifiers found
    for (const m of HEALTH_MODIFIERS) {
        if (lower.includes(m)) {
            health.push(m);
            detected.push(m);
        }
    }

    return {
        fatFree,
        reducedFat,
        wholeFat,
        unsweetened,
        sweetened,
        lowSodium,
        health,
        all: detected,
    };
}

/**
 * Check if a segment contains a dietary modifier
 * Used to prevent stripping modifiers during prep phrase separation
 */
export function containsDietaryModifier(segment: string): boolean {
    const lower = segment.toLowerCase().trim();
    return ALL_DIETARY_MODIFIERS.some(m => lower.includes(m));
}

/**
 * Extract the dietary modifier from a segment
 * Returns the modifier string if found, null otherwise
 */
export function extractDietaryModifier(segment: string): string | null {
    const lower = segment.toLowerCase().trim();
    for (const m of ALL_DIETARY_MODIFIERS) {
        if (lower.includes(m)) {
            return m;
        }
    }
    return null;
}

// ============================================================
// Modifier Synonyms (for search expansion)
// ============================================================

/**
 * Get synonym modifiers for search expansion
 * e.g., "fat free" → ["nonfat", "non-fat", "skim"]
 */
export function getModifierSynonyms(modifier: string): string[] {
    const lower = modifier.toLowerCase();

    // Fat-free group
    if (FAT_FREE_MODIFIERS.some(m => m === lower)) {
        return FAT_FREE_MODIFIERS.filter(m => m !== lower) as unknown as string[];
    }

    // Reduced-fat group
    if (REDUCED_FAT_MODIFIERS.some(m => m === lower)) {
        return REDUCED_FAT_MODIFIERS.filter(m => m !== lower) as unknown as string[];
    }

    // Unsweetened group
    if (UNSWEETENED_MODIFIERS.some(m => m === lower)) {
        return UNSWEETENED_MODIFIERS.filter(m => m !== lower) as unknown as string[];
    }

    // Low sodium group
    if (LOW_SODIUM_MODIFIERS.some(m => m === lower)) {
        return LOW_SODIUM_MODIFIERS.filter(m => m !== lower) as unknown as string[];
    }

    return [];
}

// ============================================================
// Modifier Matching (for candidate scoring)
// ============================================================

export type ModifierMatchResult =
    | 'exact_match'      // Query and candidate have same modifier
    | 'group_match'      // Query and candidate have same type (e.g., both fat-free variants)
    | 'mismatch'         // Query and candidate have conflicting modifiers
    | 'query_only'       // Query has modifier, candidate doesn't
    | 'candidate_only'   // Candidate has modifier, query doesn't
    | 'none';            // Neither has modifiers

/**
 * Compare modifiers between query and candidate for scoring
 */
export function compareModifiers(
    queryModifiers: DetectedModifiers,
    candidateModifiers: DetectedModifiers
): ModifierMatchResult {
    // Fat modifier comparison
    if (queryModifiers.fatFree && candidateModifiers.fatFree) return 'exact_match';
    if (queryModifiers.reducedFat && candidateModifiers.reducedFat) return 'exact_match';

    // Mismatch cases
    if (queryModifiers.fatFree && candidateModifiers.reducedFat) return 'mismatch';
    if (queryModifiers.fatFree && candidateModifiers.wholeFat) return 'mismatch';
    if (queryModifiers.reducedFat && candidateModifiers.wholeFat) return 'mismatch';

    // Sugar modifier comparison
    if (queryModifiers.unsweetened && candidateModifiers.sweetened) return 'mismatch';
    if (queryModifiers.sweetened && candidateModifiers.unsweetened) return 'mismatch';

    // Query has modifier but candidate doesn't
    if (queryModifiers.all.length > 0 && candidateModifiers.all.length === 0) {
        return 'query_only';
    }

    // Candidate has modifier but query doesn't
    if (queryModifiers.all.length === 0 && candidateModifiers.all.length > 0) {
        return 'candidate_only';
    }

    // Neither has modifiers
    if (queryModifiers.all.length === 0 && candidateModifiers.all.length === 0) {
        return 'none';
    }

    // Both have some modifiers (check for group match)
    return 'group_match';
}
