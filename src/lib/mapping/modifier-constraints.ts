/**
 * Modifier Constraints
 * 
 * Step 4 of AI Cost Reduction Refactor:
 * Penalizes or rejects candidates that violate explicit modifiers in the query.
 * 
 * @example "fat free milk" query should penalize "2% milk" candidates
 * @example "unsweetened cocoa" should reject "sweetened cocoa" candidates
 */

import { MODIFIER_SYNONYM_GROUPS } from './gather-candidates';

// ============================================================
// Types
// ============================================================

export interface ModifierConstraints {
    /**
     * Tokens that MUST be present in candidate (or synonyms).
     * @example For "fat free milk" → requiredTokens: ['fat free'] (or synonyms: 'nonfat', 'skim')
     */
    requiredTokens: string[];

    /**
     * Tokens that must NOT be present in candidate.
     * @example For "fat free milk" → bannedTokens: ['2%', 'whole', 'full fat']
     */
    bannedTokens: string[];

    /**
     * Conditional penalties: if candidate contains certain tokens, apply penalty.
     */
    penalties: Array<{
        if: string[];          // If candidate contains any of these...
        penalize: number;      // ...apply this score penalty (0-1, where 1 = reject)
        reason: string;        // Why this penalty applies
    }>;
}

export interface ConstraintResult {
    /** Penalty to subtract from score (0 = no penalty) */
    penalty: number;
    /** If true, candidate should be rejected entirely */
    rejected: boolean;
    /** Reason for rejection or penalty */
    reason?: string;
}

// ============================================================
// Modifier Detection Patterns
// ============================================================

/**
 * Map of constraint types to their detection patterns and conflicting modifiers.
 * When a modifier is detected in the query, conflicting modifiers in candidates are penalized.
 */
const MODIFIER_CONFLICTS: Array<{
    name: string;
    patterns: string[];              // Patterns that indicate this modifier
    conflicts: string[];             // Patterns that conflict with this modifier
    conflictPenalty: number;         // Penalty when conflict found (0-1)
}> = [
        {
            name: 'fat-free',
            patterns: ['fat free', 'fat-free', 'nonfat', 'non-fat', 'skim', '0%', 'zero fat'],
            conflicts: ['2%', '1%', 'whole', 'full fat', 'regular', 'reduced fat', 'low fat', 'lowfat'],
            conflictPenalty: 0.8,  // Strong penalty - user explicitly wants fat-free
        },
        {
            name: 'reduced-fat',
            patterns: ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'light', 'lite', '2%', '1%'],
            conflicts: ['whole', 'full fat', 'regular'],
            conflictPenalty: 0.6,  // Moderate penalty
        },
        {
            name: 'unsweetened',
            patterns: ['unsweetened', 'no sugar added', 'sugar free', 'sugar-free', 'no sugar', 'zero sugar'],
            conflicts: ['sweetened', 'sweet', 'with sugar', 'honey', 'maple'],
            conflictPenalty: 0.9,  // Very strong - nutrition completely different
        },
        {
            name: 'sweetened',
            patterns: ['sweetened', 'with sugar', 'honey sweetened'],
            conflicts: ['unsweetened', 'no sugar', 'sugar free', 'sugar-free'],
            conflictPenalty: 0.7,
        },
        {
            name: 'whole-grain',
            patterns: ['whole grain', 'whole wheat', 'wholegrain', 'wholewheat', 'whole-grain', 'whole-wheat'],
            conflicts: ['white', 'refined', 'enriched', 'bleached'],
            conflictPenalty: 0.5,  // Moderate - different nutrition profile
        },
        {
            name: 'extra-lean',
            patterns: ['extra lean', 'extra-lean', '95%', '93%', '95% lean', '93% lean'],
            conflicts: ['80%', '73%', '70%', 'regular', '80/20', '73/27'],
            conflictPenalty: 0.7,  // Important for meat fat content
        },
        {
            name: 'lean',
            patterns: ['lean', '90%', '85%', '90% lean', '85% lean', '90/10', '85/15'],
            conflicts: ['80%', '73%', '70%', 'regular', '80/20', '73/27'],
            conflictPenalty: 0.5,
        },
        {
            name: 'organic',
            patterns: ['organic', 'certified organic'],
            conflicts: [],  // No conflicts - user preference, not nutrition
            conflictPenalty: 0,
        },
    ];

/**
 * Generic form modifiers - these indicate a specific preparation/form that must match
 */
const FORM_MODIFIERS: Array<{
    pattern: string;
    mustMatch: boolean;  // If true, candidate MUST contain this form
}> = [
        { pattern: 'powder', mustMatch: true },
        { pattern: 'powdered', mustMatch: true },
        { pattern: 'granulated', mustMatch: true },
        { pattern: 'liquid', mustMatch: true },
        { pattern: 'dried', mustMatch: true },
        { pattern: 'fresh', mustMatch: false },  // Fresh is often implicit
        { pattern: 'frozen', mustMatch: true },
        { pattern: 'canned', mustMatch: true },
        { pattern: 'raw', mustMatch: false },  // Raw is often implicit
        { pattern: 'cooked', mustMatch: true },
        { pattern: 'roasted', mustMatch: true },
        { pattern: 'ground', mustMatch: true },
        { pattern: 'minced', mustMatch: true },
        { pattern: 'diced', mustMatch: false },
        { pattern: 'sliced', mustMatch: false },
        { pattern: 'shredded', mustMatch: true },
    ];

// ============================================================
// Main Functions
// ============================================================

/**
 * Extract modifier constraints from raw ingredient line.
 * 
 * @example
 * extractModifierConstraints("fat free milk")
 * // → {
 * //   requiredTokens: ['fat free', 'nonfat', 'skim', ...],
 * //   bannedTokens: ['2%', 'whole', 'full fat', ...],
 * //   penalties: [{ if: ['reduced fat'], penalize: 0.5, reason: 'wrong fat level' }]
 * // }
 */
export function extractModifierConstraints(rawLine: string): ModifierConstraints {
    const lower = rawLine.toLowerCase();

    const requiredTokens: string[] = [];
    const bannedTokens: string[] = [];
    const penalties: ModifierConstraints['penalties'] = [];

    // Check each modifier conflict pattern
    for (const mod of MODIFIER_CONFLICTS) {
        // Use word boundary to avoid false positive (e.g., "sweetened" in "unsweetened")
        const hasModifier = mod.patterns.some(p => {
            const regex = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            return regex.test(lower);
        });

        if (hasModifier) {
            // User specified this modifier - add synonyms as acceptable
            // Find the synonym group for this modifier
            const synonymGroup = MODIFIER_SYNONYM_GROUPS.find(group =>
                mod.patterns.some(p => group.includes(p))
            );

            if (synonymGroup) {
                requiredTokens.push(...synonymGroup);
            } else {
                requiredTokens.push(...mod.patterns);
            }

            // Add conflicts as banned or penalty
            if (mod.conflictPenalty >= 0.8) {
                // Strong conflict - add as banned
                bannedTokens.push(...mod.conflicts);
            } else if (mod.conflictPenalty > 0) {
                // Moderate conflict - add as penalty
                penalties.push({
                    if: mod.conflicts,
                    penalize: mod.conflictPenalty,
                    reason: `conflicts with ${mod.name} modifier`,
                });
            }
        }
    }

    // Check form modifiers
    for (const form of FORM_MODIFIERS) {
        if (lower.includes(form.pattern) && form.mustMatch) {
            requiredTokens.push(form.pattern);
        }
    }

    // Deduplicate
    return {
        requiredTokens: [...new Set(requiredTokens)],
        bannedTokens: [...new Set(bannedTokens)],
        penalties,
    };
}

/**
 * Apply constraints to a candidate score.
 * 
 * @param candidate - Candidate with name to check
 * @param constraints - Constraints extracted from query
 * @returns Penalty and rejection status
 */
export function applyModifierConstraints(
    candidate: { name: string; brandName?: string | null },
    constraints: ModifierConstraints
): ConstraintResult {
    const candidateLower = (candidate.name + ' ' + (candidate.brandName || '')).toLowerCase();

    // Check for banned tokens (instant rejection)
    // Use word boundary check to avoid false positives (e.g., "sweet" in "unsweetened")
    for (const banned of constraints.bannedTokens) {
        // For tokens with special chars (like "2%"), use simple includes
        // For word tokens, use word boundary regex
        const hasSpecialChars = /[^a-zA-Z0-9\s]/.test(banned);
        let matches: boolean;

        if (hasSpecialChars) {
            // Simple includes for tokens with special characters
            matches = candidateLower.includes(banned.toLowerCase());
        } else {
            // Word boundary regex for normal words
            const bannedRegex = new RegExp(`\\b${banned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            matches = bannedRegex.test(candidateLower);
        }

        // Also check that the banned token is not part of its opposite
        // e.g., "sweetened" should not match if candidate has "unsweetened"
        const oppositePatterns: string[] = [];
        const unVersion = 'un' + banned;
        if (unVersion !== banned && !banned.startsWith('un')) {
            oppositePatterns.push(unVersion);
        }
        const freeVersion = banned.replace('ed', 'free');
        if (freeVersion !== banned) {
            oppositePatterns.push(freeVersion);
        }
        const hasOpposite = oppositePatterns.some(opp => candidateLower.includes(opp.toLowerCase()));

        if (matches && !hasOpposite) {
            return {
                penalty: 1,
                rejected: true,
                reason: `contains banned modifier: "${banned}"`,
            };
        }
    }

    // Check if at least one required token is present
    if (constraints.requiredTokens.length > 0) {
        const hasRequired = constraints.requiredTokens.some(req =>
            candidateLower.includes(req)
        );

        if (!hasRequired) {
            // Determine if the missing required token is a fat-level modifier that was
            // explicitly demanded by the user (nonfat, fat-free, low-fat, lean, etc.)
            const FAT_LEVEL_TOKENS = new Set([
                'fat free', 'fat-free', 'nonfat', 'non-fat', 'skim', '0%', 'zero fat',
                'reduced fat', 'low fat', 'lowfat', 'low-fat', 'light', 'lite', '2%', '1%',
                'extra lean', 'extra-lean', 'lean',
                'unsweetened', 'no sugar', 'sugar free', 'sugar-free', 'zero sugar',
            ]);
            const requiredIsFatOrSugar = constraints.requiredTokens.some(r =>
                FAT_LEVEL_TOKENS.has(r.toLowerCase())
            );

            // Only hard-reject if the candidate also has an explicitly contradicting fat level
            const OPPOSING_FAT_TOKENS = [
                'whole', 'full fat', 'full-fat', 'regular',
                'sweetened', 'with sugar',
                // Full-fat dairy indicators
                'whole milk', '3.25%', '3.5%',
            ];
            const candidateHasOpposingFat = OPPOSING_FAT_TOKENS.some(t =>
                candidateLower.includes(t)
            );

            if (requiredIsFatOrSugar && candidateHasOpposingFat) {
                return {
                    penalty: 1,
                    rejected: true,
                    reason: `fat/sugar modifier mismatch: query requires "${constraints.requiredTokens.slice(0, 2).join('/')}" but candidate has opposing modifier`,
                };
            }

            // Otherwise soft penalty — candidate might just use different phrasing
            return {
                penalty: 0.4,
                rejected: false,
                reason: `missing required modifier (expected one of: ${constraints.requiredTokens.slice(0, 3).join(', ')}...)`,
            };
        }
    }

    // Check conditional penalties
    let totalPenalty = 0;
    let penaltyReason: string | undefined;

    for (const penaltyRule of constraints.penalties) {
        const triggered = penaltyRule.if.some(pattern => {
            // Use word boundary to avoid false positives
            const regex = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const matches = regex.test(candidateLower);
            // Exclude if the opposite form is present (e.g., "unsweetened" negates "sweetened")
            const opposites = ['un' + pattern, pattern.replace('ed', 'free')];
            const hasOpposite = opposites.some(opp => candidateLower.includes(opp));
            return matches && !hasOpposite;
        });
        if (triggered) {
            totalPenalty = Math.max(totalPenalty, penaltyRule.penalize);
            penaltyReason = penaltyRule.reason;
        }
    }

    return {
        penalty: totalPenalty,
        rejected: false,
        reason: penaltyReason,
    };
}

/**
 * Check if the query has any modifier constraints that should be enforced.
 * Used to determine if constraint checking is needed.
 */
export function hasModifierConstraints(rawLine: string): boolean {
    const lower = rawLine.toLowerCase();

    // Check if any modifier patterns match
    for (const mod of MODIFIER_CONFLICTS) {
        if (mod.patterns.some(p => lower.includes(p))) {
            return true;
        }
    }

    // Check form modifiers
    for (const form of FORM_MODIFIERS) {
        if (lower.includes(form.pattern) && form.mustMatch) {
            return true;
        }
    }

    return false;
}
