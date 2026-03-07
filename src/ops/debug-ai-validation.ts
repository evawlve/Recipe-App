/**
 * Debug script to investigate AI validation nutrition issues
 * 
 * This script tests specific failing ingredients from the pilot import
 * and logs the exact nutrition data sent to AI validation
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { mapIngredientWithFatsecret } from '../lib/fatsecret/map-ingredient';
import { validateMappingWithAI } from '../lib/fatsecret/ai-validation';

// Test cases from the failing pilot run
const TEST_CASES = [
    {
        name: 'Protein Powder',
        ingredient: '8 scoop chocolate protein powder',
        expectedIssue: 'AI rejects 6.7g fat as "below range" despite being within 2-12g'
    },
    {
        name: 'Honey',
        ingredient: '1 cup honey',
        expectedIssue: 'AI thinks 304.8 kcal is "too high" but it\'s correct for 100g'
    },
    {
        name: 'Quick Oats',
        ingredient: '1 cup quick oats',
        expectedIssue: 'AI thinks 400 kcal/100g exceeds acceptable range'
    },
    {
        name: 'Almond Milk',
        ingredient: '0.5 cup almond milk vanilla',
        expectedIssue: 'no_suitable_serving_found - never reaches AI validation'
    },
    {
        name: 'Reduced-Fat Peanut Butter',
        ingredient: '4 keto peanut butter fat bombs',
        expectedIssue: 'AI rejects 34g fat as exceeding 35-45g range (should be acceptable)'
    }
];

type DebugResult = {
    testCase: typeof TEST_CASES[0];
    timestamp: string;
    mappingResult: any;
    per100Nutrition: any;
    perServingNutrition: any;
    aiValidationInput: any;
    aiValidationResult: any;
    manualValidationResult: any;
    analysis: any;
    error?: string;
};

async function debugIngredient(testCase: typeof TEST_CASES[0]): Promise<DebugResult> {
    const result: DebugResult = {
        testCase,
        timestamp: new Date().toISOString(),
        mappingResult: null,
        per100Nutrition: null,
        perServingNutrition: null,
        aiValidationInput: null,
        aiValidationResult: null,
        manualValidationResult: null,
        analysis: {},
    };

    try {
        // Step 1: Map the ingredient
        const mapped = await mapIngredientWithFatsecret(testCase.ingredient, {
            minConfidence: 0.5,
            debug: false // Disable debug logging to keep output clean
        });

        if (!mapped) {
            result.error = 'Mapping failed - no result returned';
            return result;
        }

        result.mappingResult = {
            foodName: mapped.foodName,
            brandName: mapped.brandName,
            foodId: mapped.foodId,
            servingDescription: mapped.servingDescription,
            grams: mapped.grams,
            confidence: mapped.confidence,
            macros: {
                kcal: mapped.kcal,
                protein: mapped.protein,
                carbs: mapped.carbs,
                fat: mapped.fat,
            }
        };

        // Calculate per-100g nutrition (same as map-ingredient.ts does)
        const per100 = mapped.grams && mapped.grams > 0
            ? {
                protein: (mapped.protein / mapped.grams) * 100,
                carbs: (mapped.carbs / mapped.grams) * 100,
                fat: (mapped.fat / mapped.grams) * 100,
                kcal: (mapped.kcal / mapped.grams) * 100,
            }
            : undefined;

        result.per100Nutrition = per100;
        result.perServingNutrition = {
            description: mapped.servingDescription,
            grams: mapped.grams,
            protein: mapped.protein,
            carbs: mapped.carbs,
            fat: mapped.fat,
            kcal: mapped.kcal,
        };

        // Store what AI validation receives
        result.aiValidationInput = {
            per100: per100,
            perServing: result.perServingNutrition,
        };

        // Check AI validation result if it exists
        if (mapped.aiValidation) {
            result.aiValidationResult = {
                approved: mapped.aiValidation.approved,
                confidence: mapped.aiValidation.confidence,
                category: mapped.aiValidation.category,
                reason: mapped.aiValidation.reason,
                detectedIssues: mapped.aiValidation.detectedIssues,
            };

            // Re-run AI validation manually to see raw response
            try {
                const manualValidation = await validateMappingWithAI(testCase.ingredient, {
                    foodId: mapped.foodId,
                    foodName: mapped.foodName,
                    brandName: mapped.brandName,
                    searchQuery: testCase.ingredient,
                    ourConfidence: mapped.confidence,
                    nutrition: {
                        protein: per100?.protein ?? 0,
                        carbs: per100?.carbs ?? 0,
                        fat: per100?.fat ?? 0,
                        kcal: per100?.kcal ?? 0,
                    },
                });

                result.manualValidationResult = manualValidation;

                // Analysis
                if (!manualValidation.approved) {
                    result.analysis.rejected = true;

                    // Check for fat range issues
                    if (manualValidation.category === 'fat_mismatch' && per100) {
                        result.analysis.fatMismatch = {
                            per100gFat: per100.fat,
                            perServingFat: mapped.fat,
                            servingGrams: mapped.grams,
                        };

                        // Check protein powder range
                        if (testCase.name === 'Protein Powder') {
                            result.analysis.proteinPowderCheck = {
                                expectedRange: '2-12g fat per 100g',
                                actual: per100.fat,
                                isWithinRange: per100.fat >= 2 && per100.fat <= 12,
                            };
                        }
                    }

                    // Check for calorie issues
                    if (manualValidation.reason.toLowerCase().includes('calorie') && per100) {
                        result.analysis.calorieIssue = {
                            per100gCalories: per100.kcal,
                            perServingCalories: mapped.kcal,
                            servingGrams: mapped.grams,
                        };

                        if (testCase.name === 'Honey') {
                            result.analysis.honeyCheck = {
                                expectedRange: '300-330 kcal/100g',
                                actual: per100.kcal,
                                isWithinRange: per100.kcal >= 300 && per100.kcal <= 330,
                            };
                        }
                    }
                }
            } catch (error) {
                result.analysis.manualValidationError = (error as Error).message;
            }
        } else {
            result.analysis.noAiValidation = true;
        }

    } catch (error) {
        result.error = (error as Error).message;
        result.analysis.errorStack = (error as Error).stack;
    }

    return result;
}

async function main() {
    const sessionId = `ai-validation-debug-${new Date().toISOString().replace(/:/g, '-').split('.')[0]}`;
    const logPath = path.join(process.cwd(), 'logs', `${sessionId}.json`);

    // Ensure logs directory exists
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    console.log('🚀 Starting AI Validation Debug Session');
    console.log(`📝 Results will be saved to: ${logPath}\n`);

    const results: DebugResult[] = [];

    for (const testCase of TEST_CASES) {
        console.log(`Testing: ${testCase.name}...`);
        const result = await debugIngredient(testCase);
        results.push(result);

        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Write results to file
    const output = {
        sessionId,
        timestamp: new Date().toISOString(),
        testCases: TEST_CASES.length,
        results,
        summary: {
            total: results.length,
            mapped: results.filter(r => r.mappingResult !== null).length,
            aiRejected: results.filter(r => r.aiValidationResult && !r.aiValidationResult.approved).length,
            errors: results.filter(r => r.error).length,
        }
    };

    fs.writeFileSync(logPath, JSON.stringify(output, null, 2), 'utf-8');

    console.log('\n' + '='.repeat(80));
    console.log('✅ Debug session complete!');
    console.log(`📝 Results saved to: ${logPath}`);
    console.log('='.repeat(80));
    console.log('\nSummary:');
    console.log(`  Total tests: ${output.summary.total}`);
    console.log(`  Successfully mapped: ${output.summary.mapped}`);
    console.log(`  AI rejected: ${output.summary.aiRejected}`);
    console.log(`  Errors: ${output.summary.errors}`);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
