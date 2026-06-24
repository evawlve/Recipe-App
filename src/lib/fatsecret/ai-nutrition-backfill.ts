/**
 * AI Nutrition Backfill
 * 
 * Last-resort module: when the mapping pipeline exhausts all search + fallback
 * strategies and cannot find a suitable match, this generates nutritional data
 * from a capable LLM.
 * 
 * Features:
 * - Atwater equation validation (protein*4 + carbs*4 + fat*9 ≈ reported calories)
 * - Sanity bounds on all macro values
 * - Caching via AiGeneratedFood table (normalized ingredient name as key)
 * - Serving estimation for common units (cup, tbsp, packet, etc.)
 * - Base food context passing from failed candidates
 * 
 * @module ai-nutrition-backfill
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { callStructuredLlm } from '../ai/structured-client';
import { AI_NUTRITION_BACKFILL_ENABLED, AI_NUTRITION_MAX_PER_BATCH } from './config';
import type { UnifiedCandidate } from './gather-candidates';
import { extractModifierConstraints } from './modifier-constraints';

// ============================================================
// Types
// ============================================================

export interface AiNutritionResult {
    status: 'success';
    foodId: string;
    displayName: string;
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    fiberPer100g: number;
    sugarPer100g: number;
    sodiumMgPer100g: number;
    saturatedFatPer100g: number;
    cholesterolMgPer100g: number;
    confidence: number;
    notes: string;
    model: string;
    cached: boolean;
}

export interface AiNutritionError {
    status: 'error';
    reason: string;
}

export type AiNutritionOutcome = AiNutritionResult | AiNutritionError;

export interface BaseFoodContext {
    name: string;
    source: 'fatsecret' | 'fdc' | 'cache' | 'openfoodfacts';
    kcalPer100g?: number;
    proteinPer100g?: number;
    carbsPer100g?: number;
    fatPer100g?: number;
}

export interface AiNutritionOptions {
    rawLine?: string;
    baseFoodContext?: BaseFoodContext;
    /** If true, this is a batch import (fail gracefully, count toward batch cap) */
    isBatchMode?: boolean;
}

// ============================================================
// Batch tracking
// ============================================================

let batchCallCount = 0;

/** Reset the batch call counter (call at start of each batch run) */
export function resetNutritionBatchCounter(): void {
    batchCallCount = 0;
}

/** Get current batch call count */
export function getNutritionBatchCount(): number {
    return batchCallCount;
}

// ============================================================
// JSON Schema for LLM response
// ============================================================

const NUTRITION_RESPONSE_SCHEMA = {
    name: 'ai_nutrition_estimate',
    strict: true,
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            displayName: {
                type: 'string',
                description: 'Human-readable food name (e.g., "Gluten-Free Salad Seasoning")',
            },
            caloriesPer100g: { type: 'number', description: 'Calories (kcal) per 100g' },
            proteinPer100g: { type: 'number', description: 'Protein (g) per 100g' },
            carbsPer100g: { type: 'number', description: 'Total carbohydrates (g) per 100g' },
            fatPer100g: { type: 'number', description: 'Total fat (g) per 100g' },
            fiberPer100g: { type: 'number', description: 'Dietary fiber (g) per 100g' },
            sugarPer100g: { type: 'number', description: 'Total sugars (g) per 100g' },
            sodiumMgPer100g: { type: 'number', description: 'Sodium (mg) per 100g' },
            saturatedFatPer100g: { type: 'number', description: 'Saturated fat (g) per 100g' },
            cholesterolMgPer100g: { type: 'number', description: 'Cholesterol (mg) per 100g' },
            confidence: {
                type: 'number',
                description: 'Your confidence in this data (0-1). Use 0.9+ only for well-known foods.',
            },
            notes: {
                type: 'string',
                description: 'Any caveats about the data (e.g., "varies by brand", "estimated from similar products")',
            },
            gramsPerCup: {
                type: ['number', 'null'],
                description: 'Estimated grams per 1 cup (240ml) for this food, or null if not applicable',
            },
            gramsPerTbsp: {
                type: ['number', 'null'],
                description: 'Estimated grams per 1 tablespoon (15ml), or null if not applicable',
            },
            gramsPerTsp: {
                type: ['number', 'null'],
                description: 'Estimated grams per 1 teaspoon (5ml), or null if not applicable',
            },
            gramsPerPiece: {
                type: ['number', 'null'],
                description: 'Estimated grams per typical piece/unit/packet, or null if not applicable',
            },
        },
        required: [
            'displayName', 'caloriesPer100g', 'proteinPer100g', 'carbsPer100g',
            'fatPer100g', 'fiberPer100g', 'sugarPer100g', 'sodiumMgPer100g',
            'saturatedFatPer100g', 'cholesterolMgPer100g', 'confidence', 'notes',
            'gramsPerCup', 'gramsPerTbsp', 'gramsPerTsp', 'gramsPerPiece',
        ],
    },
};

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = [
    'You are a certified nutritionist with expertise in food composition databases.',
    'You have extensive knowledge of USDA FoodData Central, nutrition labels, and food science.',
    'Your goal is to provide accurate nutritional data per 100g for food items.',
    '',
    'Rules:',
    '- All values must be per 100g of the RAW/UNCOOKED form unless the food is always consumed cooked (e.g., bread, pasta).',
    '- Use realistic values based on known foods. Do NOT make up unrealistic numbers.',
    '- Calories should approximately follow the Atwater equation: calories ≈ protein*4 + carbs*4 + fat*9.',
    '- If the food is a dietary variant (fat-free, low-fat, reduced-fat, skim, light, lite, sugar-free), you MUST dramatically adjust macros accordingly from the base food. Example: For low-fat/fat-free, fatPer100g MUST be strictly reduced.',
    '- For serving size estimates, use standard US measuring cups (240ml) and tablespoons (15ml).',
    '- If the food is a commonly counted discrete item (e.g., pepper, cracker, slice, clove, berry), you MUST provide a realistic gramsPerPiece estimate.',
    '- Confidence should be 0.9+ for well-known generic foods, 0.6-0.8 for variants/brands, <0.6 for obscure items.',
].join('\n');

// ============================================================
// Prompt Builder
// ============================================================

function buildUserPrompt(ingredientName: string, baseFoodContext?: BaseFoodContext): string {
    const lines: string[] = [
        `Generate nutritional data per 100g for: "${ingredientName}"`,
    ];

    if (baseFoodContext && baseFoodContext.kcalPer100g != null) {
        lines.push('');
        lines.push(`Reference food (closest API match): "${baseFoodContext.name}" [source: ${baseFoodContext.source}]`);
        lines.push(`  - Calories: ${baseFoodContext.kcalPer100g.toFixed(0)} kcal/100g`);
        if (baseFoodContext.proteinPer100g != null) lines.push(`  - Protein: ${baseFoodContext.proteinPer100g.toFixed(1)}g/100g`);
        if (baseFoodContext.carbsPer100g != null) lines.push(`  - Carbs: ${baseFoodContext.carbsPer100g.toFixed(1)}g/100g`);
        if (baseFoodContext.fatPer100g != null) lines.push(`  - Fat: ${baseFoodContext.fatPer100g.toFixed(1)}g/100g`);
        lines.push('Use this as a starting point and adjust for the actual ingredient.');
    }

    const constraints = extractModifierConstraints(ingredientName);
    
    // Identify if the user strictly demanded something that contradicts a standard base food
    let modifierAlert = '';
    const isFatFree = constraints.requiredTokens.some(t => ['fat free', 'nonfat', 'skim', 'zero fat', '0%'].includes(t));
    const isLowFat = constraints.requiredTokens.some(t => ['reduced fat', 'low fat', 'lowfat', 'light', 'lite', '2%', '1%'].includes(t));
    const isSugarFree = constraints.requiredTokens.some(t => ['unsweetened', 'no sugar', 'sugar free', 'zero sugar'].includes(t));
    const isLean = constraints.requiredTokens.some(t => ['lean', 'extra lean', '9', '8'].some(l => t.includes(l)));

    if (isFatFree) {
        modifierAlert = 'FAT FREE or NONFAT. You MUST aggressively lower the fat to ~0g and scale down calories from the reference food.';
    } else if (isLowFat) {
        modifierAlert = 'LOW FAT or LIGHT. You MUST significantly lower the fat and calories from the reference food.';
    } else if (isSugarFree) {
        modifierAlert = 'SUGAR FREE or UNSWEETENED. You MUST drop the sugar to ~0g and lower carbs/calories accordingly compared to the reference.';
    } else if (isLean) {
        modifierAlert = 'LEAN. Reduce fat and calories appropriately compared to the generic reference food.';
    }

    if (modifierAlert) {
        lines.push('');
        lines.push(`CRITICAL CONSTRAINT: The target food is ${modifierAlert}`);
        lines.push(`Do NOT blindly copy the reference food's macros. Adjust them strictly to honor this constraint.`);
    }

    lines.push('');
    lines.push('Also estimate serving weights (grams per cup, tbsp, tsp, piece) if applicable.');

    return lines.join('\n');
}

// ============================================================
// Validation
// ============================================================

interface ValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * Validate AI nutrition response with Atwater equation check and sanity bounds.
 */
function validateNutrition(data: Record<string, unknown>): ValidationResult {
    const cal = data.caloriesPer100g as number;
    const protein = data.proteinPer100g as number;
    const carbs = data.carbsPer100g as number;
    const fat = data.fatPer100g as number;

    // Sanity bounds
    if (cal < 0 || cal > 900) return { valid: false, reason: `calories out of range: ${cal}` };
    if (protein < 0 || protein > 100) return { valid: false, reason: `protein out of range: ${protein}` };
    if (carbs < 0 || carbs > 100) return { valid: false, reason: `carbs out of range: ${carbs}` };
    if (fat < 0 || fat > 100) return { valid: false, reason: `fat out of range: ${fat}` };

    // Atwater equation: calories ≈ protein*4 + carbs*4 + fat*9
    // Allow 25% tolerance
    const atwaterCalories = protein * 4 + carbs * 4 + fat * 9;
    if (cal > 0 && atwaterCalories > 0) {
        const ratio = cal / atwaterCalories;
        if (ratio < 0.75 || ratio > 1.25) {
            return {
                valid: false,
                reason: `Atwater mismatch: reported ${cal.toFixed(0)} kcal vs computed ${atwaterCalories.toFixed(0)} kcal (ratio: ${ratio.toFixed(2)})`,
            };
        }
    }

    // Confidence check
    const confidence = data.confidence as number;
    if (confidence < 0 || confidence > 1) return { valid: false, reason: `confidence out of range: ${confidence}` };

    // Macros shouldn't exceed 100g total per 100g food
    const totalMacros = protein + carbs + fat;
    if (totalMacros > 105) {
        return { valid: false, reason: `total macros exceed 100g: P${protein} + C${carbs} + F${fat} = ${totalMacros.toFixed(1)}g` };
    }

    return { valid: true };
}

// ============================================================
// Cache Operations
// ============================================================

/**
 * Check if we have cached AI nutrition data for this ingredient.
 */
export async function getCachedAiNutrition(normalizedName: string): Promise<AiNutritionResult | null> {
    try {
        const cached = await prisma.aiGeneratedFood.findUnique({
            where: { ingredientName: normalizedName },
        });

        if (!cached) return null;

        // Increment use count (fire-and-forget)
        prisma.aiGeneratedFood.update({
            where: { id: cached.id },
            data: { useCount: { increment: 1 } },
        }).catch(() => { /* ignore */ });

        return {
            status: 'success',
            foodId: cached.id,
            displayName: cached.displayName,
            caloriesPer100g: cached.caloriesPer100g,
            proteinPer100g: cached.proteinPer100g,
            carbsPer100g: cached.carbsPer100g,
            fatPer100g: cached.fatPer100g,
            fiberPer100g: cached.fiberPer100g ?? 0,
            sugarPer100g: cached.sugarPer100g ?? 0,
            sodiumMgPer100g: cached.sodiumMgPer100g ?? 0,
            saturatedFatPer100g: cached.saturatedFatPer100g ?? 0,
            cholesterolMgPer100g: cached.cholesterolMgPer100g ?? 0,
            confidence: cached.aiConfidence,
            notes: cached.aiNotes ?? '',
            model: cached.aiModel,
            cached: true,
        };
    } catch (err) {
        logger.warn('ai_nutrition.cache_lookup_failed', { normalizedName, error: (err as Error).message });
        return null;
    }
}

/**
 * Save AI nutrition result to the database.
 */
async function saveAiNutrition(
    normalizedName: string,
    rawLine: string | undefined,
    data: Record<string, unknown>,
    model: string,
    baseFoodContext?: BaseFoodContext,
): Promise<string> {
    const record = await prisma.aiGeneratedFood.upsert({
        where: { ingredientName: normalizedName },
        create: {
            ingredientName: normalizedName,
            rawLine: rawLine ?? null,
            displayName: data.displayName as string,
            caloriesPer100g: data.caloriesPer100g as number,
            proteinPer100g: data.proteinPer100g as number,
            carbsPer100g: data.carbsPer100g as number,
            fatPer100g: data.fatPer100g as number,
            fiberPer100g: data.fiberPer100g as number,
            sugarPer100g: data.sugarPer100g as number,
            sodiumMgPer100g: data.sodiumMgPer100g as number,
            saturatedFatPer100g: data.saturatedFatPer100g as number,
            cholesterolMgPer100g: data.cholesterolMgPer100g as number,
            aiConfidence: data.confidence as number,
            aiModel: model,
            aiNotes: (data.notes as string) || null,
            baseFoodName: baseFoodContext?.name ?? null,
            baseFoodSource: baseFoodContext?.source ?? null,
        },
        update: {
            displayName: data.displayName as string,
            caloriesPer100g: data.caloriesPer100g as number,
            proteinPer100g: data.proteinPer100g as number,
            carbsPer100g: data.carbsPer100g as number,
            fatPer100g: data.fatPer100g as number,
            fiberPer100g: data.fiberPer100g as number,
            sugarPer100g: data.sugarPer100g as number,
            sodiumMgPer100g: data.sodiumMgPer100g as number,
            saturatedFatPer100g: data.saturatedFatPer100g as number,
            cholesterolMgPer100g: data.cholesterolMgPer100g as number,
            aiConfidence: data.confidence as number,
            aiModel: model,
            aiNotes: (data.notes as string) || null,
            baseFoodName: baseFoodContext?.name ?? null,
            baseFoodSource: baseFoodContext?.source ?? null,
        },
    });

    // Save serving estimates if provided
    const servingEntries: Array<{ label: string; grams: number; volumeMl: number | null }> = [];

    if (typeof data.gramsPerCup === 'number' && data.gramsPerCup > 0) {
        servingEntries.push({ label: 'cup', grams: data.gramsPerCup, volumeMl: 240 });
    }
    if (typeof data.gramsPerTbsp === 'number' && data.gramsPerTbsp > 0) {
        servingEntries.push({ label: 'tbsp', grams: data.gramsPerTbsp, volumeMl: 15 });
    }
    if (typeof data.gramsPerTsp === 'number' && data.gramsPerTsp > 0) {
        servingEntries.push({ label: 'tsp', grams: data.gramsPerTsp, volumeMl: 5 });
    }
    if (typeof data.gramsPerPiece === 'number' && data.gramsPerPiece > 0) {
        servingEntries.push({ label: 'piece', grams: data.gramsPerPiece, volumeMl: null });
    }

    // Also add a 100g reference serving
    servingEntries.push({ label: 'g', grams: 100, volumeMl: null });

    for (const entry of servingEntries) {
        await prisma.aiGeneratedServing.upsert({
            where: {
                foodId_label: { foodId: record.id, label: entry.label },
            },
            create: {
                foodId: record.id,
                label: entry.label,
                grams: entry.grams,
                volumeMl: entry.volumeMl,
                aiConfidence: data.confidence as number,
                aiNotes: null,
            },
            update: {
                grams: entry.grams,
                volumeMl: entry.volumeMl,
                aiConfidence: data.confidence as number,
            },
        });
    }

    return record.id;
}

// ============================================================
// Base Food Context Builder
// ============================================================

/**
 * Extract base food context from failed pipeline candidates.
 * Uses the top candidate (pre-filter) as reference for the AI.
 */
export function extractBaseFoodContext(
    allCandidates: UnifiedCandidate[],
): BaseFoodContext | undefined {
    if (allCandidates.length === 0) return undefined;

    // Take the top candidate by score
    const top = allCandidates.reduce((best, c) => c.score > best.score ? c : best, allCandidates[0]);

    if (!top.nutrition) return undefined;

    return {
        name: top.name,
        source: top.source,
        kcalPer100g: top.nutrition.kcal,
        proteinPer100g: top.nutrition.protein,
        carbsPer100g: top.nutrition.carbs,
        fatPer100g: top.nutrition.fat,
    };
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Generate AI nutrition data for an ingredient that couldn't be found via API.
 * 
 * Checks cache first, then calls the LLM. Validates results with Atwater equation
 * and sanity bounds. Saves to AiGeneratedFood + AiGeneratedServing tables.
 * 
 * @param normalizedName - The normalized ingredient name (used as cache key)
 * @param options - Additional context (raw line, base food, batch mode)
 * @returns Nutrition result or error
 */
export async function requestAiNutrition(
    normalizedName: string,
    options: AiNutritionOptions = {},
): Promise<AiNutritionOutcome> {
    // Check feature flag
    if (!AI_NUTRITION_BACKFILL_ENABLED) {
        return { status: 'error', reason: 'ai_nutrition_backfill_disabled' };
    }

    // Check batch cap
    if (options.isBatchMode && batchCallCount >= AI_NUTRITION_MAX_PER_BATCH) {
        logger.info('ai_nutrition.batch_cap_reached', {
            normalizedName,
            count: batchCallCount,
            max: AI_NUTRITION_MAX_PER_BATCH,
        });
        return { status: 'error', reason: 'batch_cap_reached' };
    }

    // Check cache first
    const cached = await getCachedAiNutrition(normalizedName);
    if (cached) {
        logger.info('ai_nutrition.cache_hit', { normalizedName, foodId: cached.foodId });
        return cached;
    }

    // Call LLM
    logger.info('ai_nutrition.calling_llm', { normalizedName, hasBaseFoodContext: !!options.baseFoodContext });

    const userPrompt = buildUserPrompt(normalizedName, options.baseFoodContext);

    const result = await callStructuredLlm({
        schema: NUTRITION_RESPONSE_SCHEMA,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        purpose: 'nutrition',
    });

    // Track batch calls
    if (options.isBatchMode) {
        batchCallCount++;
    }

    if (result.status === 'error') {
        logger.warn('ai_nutrition.llm_failed', { normalizedName, error: result.error });
        return { status: 'error', reason: result.error ?? 'llm_call_failed' };
    }

    const data = result.content;
    if (!data) {
        return { status: 'error', reason: 'empty_llm_response' };
    }

    // Validate the response
    const validation = validateNutrition(data);
    if (!validation.valid) {
        logger.warn('ai_nutrition.validation_failed', {
            normalizedName,
            reason: validation.reason,
            data,
        });
        return { status: 'error', reason: `validation_failed: ${validation.reason}` };
    }

    // Save to database
    try {
        const foodId = await saveAiNutrition(
            normalizedName,
            options.rawLine,
            data,
            result.model,
            options.baseFoodContext,
        );

        logger.info('ai_nutrition.success', {
            normalizedName,
            foodId,
            calories: data.caloriesPer100g,
            confidence: data.confidence,
            model: result.model,
        });

        return {
            status: 'success',
            foodId,
            displayName: data.displayName as string,
            caloriesPer100g: data.caloriesPer100g as number,
            proteinPer100g: data.proteinPer100g as number,
            carbsPer100g: data.carbsPer100g as number,
            fatPer100g: data.fatPer100g as number,
            fiberPer100g: (data.fiberPer100g as number) ?? 0,
            sugarPer100g: (data.sugarPer100g as number) ?? 0,
            sodiumMgPer100g: (data.sodiumMgPer100g as number) ?? 0,
            saturatedFatPer100g: (data.saturatedFatPer100g as number) ?? 0,
            cholesterolMgPer100g: (data.cholesterolMgPer100g as number) ?? 0,
            confidence: data.confidence as number,
            notes: (data.notes as string) ?? '',
            model: result.model,
            cached: false,
        };
    } catch (err) {
        logger.error('ai_nutrition.save_failed', { normalizedName, error: (err as Error).message });
        return { status: 'error', reason: `save_failed: ${(err as Error).message}` };
    }
}

// ============================================================
// Serving Lookup
// ============================================================

/** Standard volume units → ml mapping */
const UNIT_TO_ML: Record<string, number> = {
    cup: 240, cups: 240,
    tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
    ml: 1, milliliter: 1, milliliters: 1,
    'fl oz': 30, floz: 30,
    l: 1000, liter: 1000, liters: 1000,
};

/** Count-based unit aliases → canonical label */
const COUNT_ALIASES: Record<string, string> = {
    piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
    packet: 'piece', packets: 'piece', sachet: 'piece',
    slice: 'piece', slices: 'piece',
    item: 'piece', items: 'piece',
    each: 'piece', ea: 'piece',
    serving: 'piece', servings: 'piece',
};

/**
 * Look up the grams for a serving unit from AiGeneratedServing.
 * Falls back to density estimation for volume units without explicit serving data.
 */
export async function getAiServingGrams(
    foodId: string,
    unit: string,
    qty: number,
): Promise<{ grams: number; servingLabel: string } | null> {
    const unitLower = unit.toLowerCase().trim();

    // Check for weight units first
    if (unitLower === 'g' || unitLower === 'gram' || unitLower === 'grams') {
        return { grams: qty, servingLabel: `${qty} g` };
    }
    if (unitLower === 'oz' || unitLower === 'ounce' || unitLower === 'ounces') {
        return { grams: qty * 28.3495, servingLabel: `${qty} oz` };
    }
    if (unitLower === 'lb' || unitLower === 'lbs' || unitLower === 'pound' || unitLower === 'pounds') {
        return { grams: qty * 453.592, servingLabel: `${qty} lb` };
    }
    if (unitLower === 'kg' || unitLower === 'kilogram' || unitLower === 'kilograms') {
        return { grams: qty * 1000, servingLabel: `${qty} kg` };
    }

    // Try direct DB lookup for volume/count labels
    const canonicalLabel = COUNT_ALIASES[unitLower] || unitLower;

    // Try exact match first, then canonical alias
    const labelsToTry = [unitLower, canonicalLabel];
    if (unitLower.endsWith('s') && unitLower.length > 2) {
        labelsToTry.push(unitLower.slice(0, -1)); // singular form
    }

    for (const label of [...new Set(labelsToTry)]) {
        const serving = await prisma.aiGeneratedServing.findUnique({
            where: { foodId_label: { foodId, label } },
        });
        if (serving) {
            return {
                grams: serving.grams * qty,
                servingLabel: `${qty} ${unit}`,
            };
        }
    }

    // Fallback: if this is a known volume unit, estimate from cup serving
    const volumeMl = UNIT_TO_ML[unitLower];
    if (volumeMl) {
        const cupServing = await prisma.aiGeneratedServing.findUnique({
            where: { foodId_label: { foodId, label: 'cup' } },
        });
        if (cupServing && cupServing.grams > 0) {
            // Derive from cup density:  grams = (volumeMl / 240) * gramsPerCup * qty
            const gramsPerMl = cupServing.grams / 240;
            return {
                grams: gramsPerMl * volumeMl * qty,
                servingLabel: `${qty} ${unit}`,
            };
        }
    }

    // Last fallback: 100g reference
    const gramServing = await prisma.aiGeneratedServing.findUnique({
        where: { foodId_label: { foodId, label: 'g' } },
    });
    if (gramServing) {
        // Use 100g as fallback (qty 1 = 100g)
        return { grams: 100 * qty, servingLabel: `${qty} × 100g` };
    }

    return null;
}
