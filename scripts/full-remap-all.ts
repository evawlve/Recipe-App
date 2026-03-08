/**
 * Full Unmap and Remap ALL Ingredients
 * 
 * This script:
 * 1. Snapshots existing mappings for comparison
 * 2. Clears ALL ValidatedMapping entries
 * 3. Clears ALL IngredientFoodMap entries
 * 4. Re-runs mapping on every ingredient with improved pipeline
 * 5. Generates before/after comparison report
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 2000;

interface OldMapping {
    ingredientId: string;
    rawLine: string;
    foodId: string | null;
    foodName: string | null;
    grams: number | null;
    confidence: number | null;
}

interface RemapResult {
    ingredientId: string;
    rawLine: string;
    oldFood: string | null;
    oldGrams: number | null;
    newFood: string | null;
    newGrams: number | null;
    newConfidence: number | null;
    changed: boolean;
    success: boolean;
    error?: string;
}

async function snapshotExistingMappings(): Promise<Map<string, OldMapping>> {
    console.log('📸 Snapshotting existing mappings...');

    const mappings = await prisma.ingredientFoodMap.findMany({
        include: {
            ingredient: {
                select: { id: true, name: true, qty: true, unit: true }
            }
        }
    });

    const snapshot = new Map<string, OldMapping>();

    for (const m of mappings) {
        // Get food name from cache
        let foodName: string | null = null;
        if (m.fatsecretFoodId) {
            const food = await prisma.fatSecretFoodCache.findUnique({
                where: { id: m.fatsecretFoodId },
                select: { name: true }
            });
            foodName = food?.name || null;
        }

        const rawLine = `${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}`.trim();

        snapshot.set(m.ingredientId, {
            ingredientId: m.ingredientId,
            rawLine,
            foodId: m.fatsecretFoodId,
            foodName,
            grams: m.fatsecretGrams,
            confidence: m.fatsecretConfidence,
        });
    }

    console.log(`  Found ${snapshot.size} existing mappings`);
    return snapshot;
}

async function clearAllTables(): Promise<{ validatedCount: number; foodMapCount: number }> {
    console.log('\n🧹 Clearing mapping tables...');

    // Clear ValidatedMapping
    const validatedResult = await prisma.validatedMapping.deleteMany({});
    console.log(`  ValidatedMapping: ${validatedResult.count} entries deleted`);

    // Clear IngredientFoodMap
    const foodMapResult = await prisma.ingredientFoodMap.deleteMany({});
    console.log(`  IngredientFoodMap: ${foodMapResult.count} entries deleted`);

    return {
        validatedCount: validatedResult.count,
        foodMapCount: foodMapResult.count,
    };
}

async function getAllIngredients(): Promise<Array<{ id: string; rawLine: string }>> {
    console.log('\n📋 Gathering all ingredients...');

    const ingredients = await prisma.ingredient.findMany({
        select: { id: true, name: true, qty: true, unit: true }
    });

    const result = ingredients.map(ing => ({
        id: ing.id,
        rawLine: `${ing.qty} ${ing.unit} ${ing.name}`.trim()
    }));

    console.log(`  Found ${result.length} total ingredients`);
    return result;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function remapAllIngredients(
    ingredients: Array<{ id: string; rawLine: string }>,
    oldMappings: Map<string, OldMapping>
): Promise<RemapResult[]> {
    console.log(`\n🔄 Remapping ${ingredients.length} ingredients in batches of ${BATCH_SIZE}...`);

    const results: RemapResult[] = [];
    const startTime = Date.now();
    let successCount = 0;
    let changedCount = 0;

    for (let i = 0; i < ingredients.length; i += BATCH_SIZE) {
        const batch = ingredients.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(ingredients.length / BATCH_SIZE);

        // Calculate ETA
        const elapsed = Date.now() - startTime;
        const rate = (i + 1) / (elapsed / 1000); // ingredients per second
        const remaining = ingredients.length - i;
        const etaSeconds = remaining / rate;
        const etaStr = etaSeconds > 60
            ? `${Math.round(etaSeconds / 60)}m ${Math.round(etaSeconds % 60)}s`
            : `${Math.round(etaSeconds)}s`;

        console.log(`\n  Batch ${batchNum}/${totalBatches} (ETA: ${etaStr})`);

        for (const ing of batch) {
            process.stdout.write(`    ${ing.rawLine.slice(0, 50).padEnd(50)}... `);

            try {
                const newMapping = await mapIngredientWithFallback(ing.rawLine, { debug: false });
                const oldMapping = oldMappings.get(ing.id);

                const result: RemapResult = {
                    ingredientId: ing.id,
                    rawLine: ing.rawLine,
                    oldFood: oldMapping?.foodName || null,
                    oldGrams: oldMapping?.grams || null,
                    newFood: newMapping?.foodName || null,
                    newGrams: newMapping?.grams || null,
                    newConfidence: newMapping?.confidence || null,
                    changed: false,
                    success: newMapping !== null,
                };

                if (newMapping) {
                    successCount++;

                    // Check if changed
                    if (oldMapping && (
                        oldMapping.foodId !== newMapping.foodId ||
                        Math.abs((oldMapping.grams || 0) - (newMapping.grams || 0)) > 1
                    )) {
                        result.changed = true;
                        changedCount++;
                    }

                    // Save the new mapping
                    await prisma.ingredientFoodMap.create({
                        data: {
                            ingredientId: ing.id,
                            fatsecretFoodId: newMapping.foodId,
                            fatsecretServingId: newMapping.servingId || null,
                            fatsecretGrams: newMapping.grams,
                            fatsecretConfidence: newMapping.confidence,
                            fatsecretSource: 'full_remap',
                            mappedBy: 'auto_full_remap',
                            confidence: newMapping.confidence,
                        }
                    });

                    process.stdout.write(`✓ ${newMapping.foodName?.slice(0, 30) || 'null'}\n`);
                } else {
                    process.stdout.write('✗ no match\n');
                }

                results.push(result);
            } catch (err) {
                const error = (err as Error).message;
                console.log(`✗ ERROR: ${error.slice(0, 50)}`);

                results.push({
                    ingredientId: ing.id,
                    rawLine: ing.rawLine,
                    oldFood: oldMappings.get(ing.id)?.foodName || null,
                    oldGrams: oldMappings.get(ing.id)?.grams || null,
                    newFood: null,
                    newGrams: null,
                    newConfidence: null,
                    changed: false,
                    success: false,
                    error,
                });
            }
        }

        // Delay between batches (except for last batch)
        if (i + BATCH_SIZE < ingredients.length) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    const totalTime = Math.round((Date.now() - startTime) / 1000);
    console.log(`\n✅ Completed in ${totalTime}s`);
    console.log(`   Success: ${successCount}/${ingredients.length}`);
    console.log(`   Changed: ${changedCount}`);

    return results;
}

async function writeReport(
    results: RemapResult[],
    clearedCounts: { validatedCount: number; foodMapCount: number }
): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `full-remap-${timestamp}.txt`;
    const filepath = path.join(LOG_DIR, filename);

    const successful = results.filter(r => r.success);
    const changed = results.filter(r => r.changed);
    const failed = results.filter(r => !r.success);

    const lines: string[] = [
        '# Full Remap Report',
        `# Generated: ${new Date().toISOString()}`,
        '#',
        `# Total Ingredients: ${results.length}`,
        `# Successful: ${successful.length}`,
        `# Changed: ${changed.length}`,
        `# Failed: ${failed.length}`,
        '#',
        `# Cleared: ${clearedCounts.validatedCount} ValidatedMapping, ${clearedCounts.foodMapCount} IngredientFoodMap`,
        '#',
        '',
    ];

    // Changed mappings (most interesting)
    if (changed.length > 0) {
        lines.push('## CHANGED MAPPINGS');
        lines.push('');
        for (const r of changed) {
            lines.push(`△ "${r.rawLine}"`);
            lines.push(`  OLD: ${r.oldFood || 'unmapped'} (${r.oldGrams || 0}g)`);
            lines.push(`  NEW: ${r.newFood} (${r.newGrams}g) [${r.newConfidence?.toFixed(2)}]`);
            lines.push('');
        }
    }

    // Failed mappings
    if (failed.length > 0) {
        lines.push('## FAILED MAPPINGS');
        lines.push('');
        for (const r of failed) {
            lines.push(`✗ "${r.rawLine}" - ${r.error || 'no match'}`);
        }
        lines.push('');
    }

    // Successful unchanged (summary only)
    const unchangedSuccess = successful.filter(r => !r.changed);
    if (unchangedSuccess.length > 0) {
        lines.push('## SUCCESSFUL (no change)');
        lines.push('');
        lines.push(`${unchangedSuccess.length} ingredients mapped successfully with no significant change.`);
        lines.push('');
        // Show first 20 as samples
        for (const r of unchangedSuccess.slice(0, 20)) {
            lines.push(`  ○ "${r.rawLine}" → ${r.newFood} (${r.newGrams}g)`);
        }
        if (unchangedSuccess.length > 20) {
            lines.push(`  ... and ${unchangedSuccess.length - 20} more`);
        }
    }

    // Ensure logs directory exists
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    console.log(`\n📄 Report written to: ${filepath}`);
    return filepath;
}

async function main() {
    console.log('\n========================================');
    console.log('  FULL UNMAP AND REMAP ALL INGREDIENTS  ');
    console.log('========================================\n');

    try {
        // Step 1: Snapshot existing mappings
        const oldMappings = await snapshotExistingMappings();

        // Step 2: Clear all mapping tables
        const clearedCounts = await clearAllTables();

        // Step 3: Get all ingredients
        const ingredients = await getAllIngredients();

        if (ingredients.length === 0) {
            console.log('No ingredients to process!');
            process.exit(0);
        }

        // Step 4: Remap all ingredients
        const results = await remapAllIngredients(ingredients, oldMappings);

        // Step 5: Write report
        const reportPath = await writeReport(results, clearedCounts);

        // Final summary
        console.log('\n========================================');
        console.log('  SUMMARY');
        console.log('========================================');
        console.log(`Total: ${results.length}`);
        console.log(`Successful: ${results.filter(r => r.success).length}`);
        console.log(`Changed: ${results.filter(r => r.changed).length}`);
        console.log(`Failed: ${results.filter(r => !r.success).length}`);
        console.log(`\nReport: ${reportPath}`);

    } catch (err) {
        console.error('Fatal error:', err);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

main();
