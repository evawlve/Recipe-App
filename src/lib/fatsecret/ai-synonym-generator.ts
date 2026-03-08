/**
 * AI Synonym Generator
 * 
 * Generates synonyms for ingredients post-mapping to improve future lookups.
 * 
 * CONSERVATIVE APPROACH:
 * - Only generates synonyms for British ↔ American term conversion
 * - Only for complete, standalone ingredient names (not partial words)
 * - No synonyms for generic terms like "beef", "pepper", "heavy"
 * - AI is only used for British ↔ American conversion, not general synonyms
 * 
 * Synonyms are saved to LearnedSynonym table for fast lookup.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { OPENAI_API_BASE_URL, FATSECRET_CACHE_AI_MODEL } from './config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

// ============================================================
// Minimum Length Requirement
// ============================================================

// Don't generate synonyms for short, generic words
const MIN_TERM_LENGTH = 5;

// Blocklist of generic terms that should NOT have synonyms
const GENERIC_TERMS = new Set([
    'beef', 'pork', 'chicken', 'fish', 'meat', 'lamb',
    'cream', 'milk', 'butter', 'cheese', 'egg', 'eggs',
    'salt', 'pepper', 'sugar', 'flour', 'oil',
    'heavy', 'light', 'fresh', 'dried', 'frozen',
    'red', 'green', 'white', 'black', 'brown',
    'hot', 'cold', 'warm', 'large', 'small', 'medium',
    'broth', 'stock', 'sauce', 'paste', 'powder',
    'wheat', 'grain', 'rice', 'bread', 'pasta',
    'water', 'juice', 'wine', 'vinegar',
]);

// ============================================================
// Known British → American Mappings (Fast Path)
// ============================================================
// Only complete ingredient names, no partial words

const BRITISH_TO_AMERICAN: Record<string, string[]> = {
    // Vegetables
    'aubergine': ['eggplant'],
    'aubergines': ['eggplants'],
    'courgette': ['zucchini'],
    'courgettes': ['zucchinis'],
    'rocket': ['arugula'],
    'coriander': ['cilantro'],
    'fresh coriander': ['fresh cilantro'],
    'spring onion': ['green onion', 'scallion'],
    'spring onions': ['green onions', 'scallions'],
    'beetroot': ['beet'],
    'swede': ['rutabaga'],
    'mangetout': ['snow peas'],
    'mange tout': ['snow peas'],
    'capsicum': ['bell pepper'],
    'chilli': ['chili', 'chile'],
    'chillies': ['chilis', 'chiles'],
    'red chilli': ['red chili'],
    'green chilli': ['green chili'],
    'sweetcorn': ['corn'],

    // Baking
    'bicarbonate of soda': ['baking soda'],
    'bicarb': ['baking soda'],
    'caster sugar': ['superfine sugar'],
    'castor sugar': ['superfine sugar'],
    'icing sugar': ['powdered sugar', 'confectioners sugar'],
    'plain flour': ['all-purpose flour'],
    'self-raising flour': ['self-rising flour'],
    'cornflour': ['cornstarch'],
    'golden syrup': ['light corn syrup'],
    'treacle': ['molasses'],
    'desiccated coconut': ['shredded coconut'],

    // Dairy
    'double cream': ['heavy cream', 'heavy whipping cream'],
    'single cream': ['light cream'],
    'clotted cream': ['devon cream'],

    // Proteins
    'minced beef': ['ground beef'],
    'beef mince': ['ground beef'],
    'minced pork': ['ground pork'],
    'pork mince': ['ground pork'],
    'minced lamb': ['ground lamb'],
    'lamb mince': ['ground lamb'],
    'minced chicken': ['ground chicken'],
    'chicken mince': ['ground chicken'],
    'prawns': ['shrimp'],
    'king prawns': ['jumbo shrimp'],
    'gammon': ['ham'],
    'bacon rashers': ['bacon strips'],
};

// Reverse mapping: American → British
const AMERICAN_TO_BRITISH: Record<string, string[]> = {};
for (const [british, americans] of Object.entries(BRITISH_TO_AMERICAN)) {
    for (const american of americans) {
        if (!AMERICAN_TO_BRITISH[american]) {
            AMERICAN_TO_BRITISH[american] = [];
        }
        AMERICAN_TO_BRITISH[american].push(british);
    }
}

// ============================================================
// Schema & Prompts (Very Conservative)
// ============================================================

const RESPONSE_SCHEMA = {
    name: 'synonym_generation',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            britishEquivalent: {
                type: 'string',
                description: 'British/UK term for this ingredient, or empty string if none',
            },
            americanEquivalent: {
                type: 'string',
                description: 'American term for this ingredient, or empty string if none',
            },
        },
        required: ['britishEquivalent', 'americanEquivalent'],
    },
    strict: true,
};

const SYSTEM_PROMPT = `You are a conservative culinary terminology expert.
Your ONLY task is to identify British vs American names for food ingredients.

RULES:
1. ONLY provide equivalents for COMPLETE ingredient names, not partial words
2. Return empty strings if no clear British/American equivalent exists
3. Do NOT invent synonyms - only real regional terminology differences
4. "heavy cream" (US) = "double cream" (UK) is valid
5. "beef" = "beef" (same in both) - return empty strings
6. "cream" alone - too generic, return empty strings

Be VERY conservative. When in doubt, return empty strings.`;

export interface SynonymResult {
    britishEquivalent: string;
    americanEquivalent: string;
}

// ============================================================
// Validation
// ============================================================

function isValidForSynonyms(term: string): boolean {
    const lower = term.toLowerCase().trim();

    // Too short
    if (lower.length < MIN_TERM_LENGTH) {
        return false;
    }

    // Generic term blocklist
    if (GENERIC_TERMS.has(lower)) {
        return false;
    }

    // Single word generic terms (only multi-word or specific terms get synonyms)
    const wordCount = lower.split(/\s+/).length;
    if (wordCount === 1 && GENERIC_TERMS.has(lower)) {
        return false;
    }

    return true;
}

// ============================================================
// Fast Path: Known Synonyms
// ============================================================

/**
 * Get known synonyms without AI call.
 * Returns null if no known synonyms found.
 */
export function getKnownSynonyms(term: string): string[] | null {
    const lower = term.toLowerCase().trim();

    // Check British → American
    if (BRITISH_TO_AMERICAN[lower]) {
        return [...BRITISH_TO_AMERICAN[lower]];
    }

    // Check American → British
    if (AMERICAN_TO_BRITISH[lower]) {
        return [...AMERICAN_TO_BRITISH[lower]];
    }

    return null;
}

// ============================================================
// AI Synonym Generation (Conservative)
// ============================================================

/**
 * Generate synonyms using AI - ONLY for British/American conversion.
 * Very conservative - only returns validated equivalents.
 */
export async function generateSynonymsWithAi(
    mappedFoodName: string
): Promise<string[]> {
    // Validate input
    if (!isValidForSynonyms(mappedFoodName)) {
        logger.debug('synonym_generation.skipped_invalid', { mappedFoodName });
        return [];
    }

    if (!OPENAI_API_KEY) {
        return [];
    }

    const userPrompt = `Ingredient: "${mappedFoodName}"

What is the British UK equivalent and American equivalent for this ingredient?
If this is already the same in both regions (like "chicken breast"), return empty strings.
If this is too generic or partial (like "cream" or "beef"), return empty strings.
Only provide real regional terminology differences like:
- "eggplant" (US) ↔ "aubergine" (UK)
- "heavy cream" (US) ↔ "double cream" (UK)
- "cilantro" (US) ↔ "coriander" (UK)`;

    try {
        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: FATSECRET_CACHE_AI_MODEL,
                response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0,  // Deterministic
            }),
        });

        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;

        if (!content) {
            return [];
        }

        const parsed = JSON.parse(content) as SynonymResult;
        const results: string[] = [];

        // Only add non-empty, validated equivalents
        if (parsed.britishEquivalent && parsed.britishEquivalent.trim()) {
            const british = parsed.britishEquivalent.toLowerCase().trim();
            // Validate: must be different from original and not too similar
            if (british !== mappedFoodName.toLowerCase() && british.length >= 3) {
                results.push(british);
            }
        }

        if (parsed.americanEquivalent && parsed.americanEquivalent.trim()) {
            const american = parsed.americanEquivalent.toLowerCase().trim();
            // Validate: must be different from original and not too similar
            if (american !== mappedFoodName.toLowerCase() && american.length >= 3) {
                results.push(american);
            }
        }

        return results;
    } catch (err) {
        logger.debug('synonym_generation.ai_failed', {
            mappedFoodName,
            error: (err as Error).message
        });
        return [];
    }
}

// ============================================================
// Save Synonyms to Database
// ============================================================

/**
 * Save synonyms to LearnedSynonym table.
 * Maps synonym → originalTerm (so searching for synonym finds original)
 */
export async function saveSynonyms(
    canonicalName: string,
    synonyms: string[],
    source: 'ai' | 'known'
): Promise<number> {
    let saved = 0;
    const canonicalLower = canonicalName.toLowerCase().trim();

    for (const synonym of synonyms) {
        const synonymLower = synonym.toLowerCase().trim();

        // Skip if same as canonical or empty
        if (!synonymLower || synonymLower === canonicalLower) {
            continue;
        }

        // Skip if too short
        if (synonymLower.length < 3) {
            continue;
        }

        try {
            await prisma.learnedSynonym.upsert({
                where: {
                    sourceTerm_targetTerm: {
                        sourceTerm: synonymLower,
                        targetTerm: canonicalLower,
                    }
                },
                create: {
                    sourceTerm: synonymLower,
                    targetTerm: canonicalLower,
                    source,
                    confidence: source === 'known' ? 1.0 : 0.8,
                },
                update: {
                    useCount: { increment: 1 },
                    lastUsedAt: new Date(),
                }
            });
            saved++;
        } catch (err) {
            // Ignore duplicate errors
        }
    }

    return saved;
}

// ============================================================
// Main Entry Point
// ============================================================

export interface GenerateSynonymsResult {
    saved: number;
    source: 'known' | 'ai' | 'none';
}

/**
 * Generate and save synonyms for a mapped ingredient.
 * Called post-mapping in background.
 * 
 * Very conservative: Only generates British ↔ American equivalents
 * for complete, valid ingredient names.
 */
export async function generateAndSaveSynonyms(
    mappedFoodName: string,
    _originalQuery: string  // Unused, kept for compatibility
): Promise<GenerateSynonymsResult> {
    // Validate input first
    if (!isValidForSynonyms(mappedFoodName)) {
        logger.debug('synonym_generation.skipped', {
            reason: 'invalid_term',
            mappedFoodName
        });
        return { saved: 0, source: 'none' };
    }

    // Fast path: Check known synonyms first
    const known = getKnownSynonyms(mappedFoodName);
    if (known && known.length > 0) {
        const saved = await saveSynonyms(mappedFoodName, known, 'known');
        logger.debug('synonym_generation.known', {
            mappedFoodName,
            synonyms: known,
            saved
        });
        return { saved, source: 'known' };
    }

    // Slow path: Use AI for British/American conversion only
    const aiSynonyms = await generateSynonymsWithAi(mappedFoodName);

    if (aiSynonyms.length === 0) {
        return { saved: 0, source: 'none' };
    }

    const saved = await saveSynonyms(mappedFoodName, aiSynonyms, 'ai');
    logger.info('synonym_generation.ai', {
        mappedFoodName,
        synonyms: aiSynonyms,
        saved
    });

    return { saved, source: 'ai' };
}

// ============================================================
// Synonym Lookup
// ============================================================

/**
 * Find canonical name for a synonym.
 * Returns the target term if synonym exists, null otherwise.
 */
export async function findCanonicalName(query: string): Promise<string | null> {
    const normalized = query.toLowerCase().trim();

    // Check database first
    const synonym = await prisma.learnedSynonym.findFirst({
        where: { sourceTerm: normalized },
        orderBy: { useCount: 'desc' },
    });

    if (synonym) {
        // Increment use count
        await prisma.learnedSynonym.update({
            where: { id: synonym.id },
            data: {
                useCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        }).catch(() => { }); // Best effort

        return synonym.targetTerm;
    }

    // Check known mappings without database
    const knownSynonyms = getKnownSynonyms(normalized);
    if (knownSynonyms && knownSynonyms.length > 0) {
        return knownSynonyms[0];  // Return first known synonym
    }

    return null;
}
