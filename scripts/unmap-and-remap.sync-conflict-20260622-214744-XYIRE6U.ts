/**
 * Unmap and Remap Flagged Ingredients
 * 
 * This script:
 * 1. Identifies the same flagged ingredients from the audit
 * 2. Clears their IngredientFoodMap entries (unmaps)
 * 3. Clears their ValidatedMapping cache entries
 * 4. Re-runs mapping with the improved pipeline
 * 5. Compares old vs new results
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Same flag detection as audit script
function detectIssues(entry: {
    rawLine: string;
    foodName: string | null;
    grams: number | null;
    confidence: number | null;
}): string[] {
    const flags: string[] = [];
    const raw = entry.rawLine.toLowerCase();
    const food = (entry.foodName || '').toLowerCase();

    // High grams check
    if (entry.grams && entry.grams > 400) {
        flags.push('HIGH_GRAMS');
    }

    // Low confidence
    if (entry.confidence && entry.confidence < 0.6) {
        flags.push('LOW_CONF');
    }

    // Category mismatch detection
    if (raw.includes('garlic') && !food.includes('garlic')) {
        flags.push('CATEGORY_MISMATCH');
    }
    if (raw.includes('chilies') && food.includes('tomato')) {
        flags.push('MULTI_INGREDIENT');
    }
    if ((raw.includes('reduced fat') || raw.includes('lowfat') || raw.includes('low fat'))
        && !food.includes('low') && !food.includes('reduced') && !food.includes('lean') && !food.includes('%')) {
        flags.push('MISSING_FAT_MOD');
    }

    // Serving size checks for unitless ingredients
    if (!entry.rawLine.match(/\d+\s*(cup|tbsp|tsp|oz|lb|g|ml)/i)) {
        // Unitless - check if grams are suspiciously high
        if (entry.grams && entry.grams > 100) {
            flags.push('UNITLESS_HIGH_GRAMS');
        }
    }

    return flags;
}

interface FlaggedIngredient {
    ingredientId: string;
    mapId: string;
    rawLine: string;
    oldFoodId: string | null;
    oldFoodName: string | null;
    oldGrams: number | null;
    oldConfidence: number | null;
    flags: string[];
}

async function findFlaggedIngredients(): Promise<FlaggedIngredient[]> {
    console.log('Finding flagged ingredients...');

    const mappings = await prisma.ingredientFoodMap.findMany({
        where: { fatsecretFoodId: { not: null } },
        include: {
            ingredient: {
                select: { id: true, name: true, qty: true, unit: true }
            }
        }
    });

    const flagged: FlaggedIngredient[] = [];

    for (const m of mappings) {
        // Get food name
        let foodName: string | null = null;
        if (m.fatsecretFoodId) {
            const food = await prisma.fatSecretFoodCache.findUnique({
                where: { id: m.fatsecretFoodId },
                select: { name: true }
            });
            foodName = food?.name || null;
        }

        const rawLine = `${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}`.trim();

        const flags = detectIssues({
            rawLine,
            foodName,
            grams: m.fatsecretGrams,
            confidence: m.fatsecretConfidence,
        });

        if (flags.length > 0) {
            flagged.push({
                ingredientId: m.ingredientId,
                mapId: m.id,
                rawLine,
                oldFoodId: m.fatsecretFoodId,
                oldFoodName: foodName,
                oldGrams: m.fatsecretGrams,
                oldConfidence: m.fatsecretConfidence,
                flags,
            });
        }
    }

    return flagged;
}

async function unmapIngredients(flagged: FlaggedIngredient[]) {
    console.log(`\nUnmapping ${flagged.length} ingredients...`);

    // Get unique ingredient IDs and map IDs
    const mapIds = flagged.map(f => f.mapId);

    // Delete IngredientFoodMap entries
    const deleteResult = await prisma.ingredientFoodMap.deleteMany({
        where: { id: { in: mapIds } }
    });

    console.log(`  Deleted ${deleteResult.count} IngredientFoodMap entries`);

    // Clear ValidatedMapping entries for these raw ingredients
    const rawLines = [...new Set(flagged.map(f => f.rawLine))];

    let validatedCleared = 0;
    for (const rawLine of rawLines) {
        const result = await prisma.validatedMapping.deleteMany({
            where: { rawIngredient: rawLine }
        });
        validatedCleared += result.count;
    }

    console.log(`  Cleared ${validatedCleared} ValidatedMapping cache entries`);
}

interface RemapResult {
    rawLine: string;
    oldFood: string | null;
    oldGrams: number | null;
    newFood: string | null;
    newGrams: number | null;
    newConfidence: number | null;
    success: boolean;
    improved: boolean;
    flags: string[];
}

async function remapIngredients(flagged: FlaggedIngredient[]): Promise<RemapResult[]> {
    console.log(`\nRemapping ${flagged.length} ingredients...`);

    const results: RemapResult[] = [];
    let successCount = 0;
    let improvedCount = 0;

    for (let i = 0; i < flagged.length; i++) {
        const f = flagged[i];
        process.stdout.write(`\r  Processing ${i + 1}/${flagged.length}: ${f.rawLine.slice(0, 40).padEnd(40)}...`);

        try {
            const newResult = await mapIngredientWithFallback(f.rawLine, { debug: false });

            const result: RemapResult = {
                rawLine: f.rawLine,
                oldFood: f.oldFoodName,
                oldGrams: f.oldGrams,
                newFood: newResult?.foodName || null,
                newGrams: newResult?.grams || null,
                newConfidence: newResult?.confidence || null,
                success: newResult !== null,
                improved: false,
                flags: f.flags,
            };

            if (newResult) {
                successCount++;

                // Check if improved
                if (f.flags.includes('HIGH_GRAMS') || f.flags.includes('UNITLESS_HIGH_GRAMS')) {
                    if (newResult.grams && f.oldGrams && newResult.grams < f.oldGrams * 0.5) {
                        result.improved = true;
                        improvedCount++;
                    }
                } else if (f.flags.includes('LOW_CONF')) {
                    if (newResult.confidence && f.oldConfidence && newResult.confidence > f.oldConfidence + 0.1) {
                        result.improved = true;
                        improvedCount++;
                    }
                }

                // Save the new mapping
                await prisma.ingredientFoodMap.create({
                    data: {
                        ingredientId: f.ingredientId,
                        fatsecretFoodId: newResult.foodId,
                        fatsecretServingId: newResult.servingId || null,
                        fatsecretGrams: newResult.grams,
                        fatsecretConfidence: newResult.confidence,
                        fatsecretSource: 'remap_improved',
                        mappedBy: 'auto_remap',
                        confidence: newResult.confidence,
                    }
                });
            }

            results.push(result);
        } catch (err) {
            console.error(`\n  Error: ${(err as Error).message}`);
            results.push({
                rawLine: f.rawLine,
                oldFood: f.oldFoodName,
                oldGrams: f.oldGrams,
                newFood: null,
                newGrams: null,
                newConfidence: null,
                success: false,
                improved: false,
                flags: f.flags,
            });
        }
    }

    console.log(`\n\n  Successfully remapped: ${successCount}/${flagged.length}`);
    console.log(`  Improved: ${improvedCount}`);

    return results;
}

async function writeRemapReport(results: RemapResult[]) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `remap-results-${timestamp}.txt`;
    const filepath = path.join(LOG_DIR, filename);

    const lines: string[] = [
        '# Remap Results - Flagged Ingredients',
        `# Generated: ${new Date().toISOString()}`,
        `# Total Remapped: ${results.length}`,
        '#',
    ];

    const successful = results.filter(r => r.success);
    const improved = results.filter(r => r.improved);
    const failed = results.filter(r => !r.success);

    lines.push(`# Successful: ${successful.length}`);
    lines.push(`# Improved: ${improved.length}`);
    lines.push(`# Failed: ${failed.length}`);
    lines.push('#');
    lines.push('');

    // Improved entries first
    if (improved.length > 0) {
        lines.push('## IMPROVED ✓');
        lines.push('');
        for (const r of improved) {
            lines.push(`✓ "${r.rawLine}"`);
            lines.push(`  OLD: ${r.oldFood} (${r.oldGrams}g)`);
            lines.push(`  NEW: ${r.newFood} (${r.newGrams}g) [${r.newConfidence?.toFixed(2)}]`);
            lines.push(`  Flags: ${r.flags.join(', ')}`);
            lines.push('');
        }
    }

    // Unchanged but successful
    const unchangedSuccess = successful.filter(r => !r.improved);
    if (unchangedSuccess.length > 0) {
        lines.push('## REMAPPED (no major change)');
        lines.push('');
        for (const r of unchangedSuccess.slice(0, 50)) { // Limit output
            lines.push(`○ "${r.rawLine}" → ${r.newFood} (${r.newGrams}g)`);
        }
        if (unchangedSuccess.length > 50) {
            lines.push(`  ... and ${unchangedSuccess.length - 50} more`);
        }
        lines.push('');
    }

    // Failed
    if (failed.length > 0) {
        lines.push('## FAILED ✗');
        lines.push('');
        for (const r of failed) {
            lines.push(`✗ "${r.rawLine}" - mapping failed`);
        }
    }

    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    console.log(`\nResults written to: ${filepath}`);
    return filepath;
}

async function main() {
    console.log('\n=== Unmap and Remap Flagged Ingredients ===\n');

    // Step 1: Find flagged ingredients
    const flagged = await findFlaggedIngredients();
    console.log(`Found ${flagged.length} flagged ingredients`);

    if (flagged.length === 0) {
        console.log('No flagged ingredients to process!');
        process.exit(0);
    }

    // Show breakdown
    const byFlag: Record<string, number> = {};
    for (const f of flagged) {
        for (const flag of f.flags) {
            byFlag[flag] = (byFlag[flag] || 0) + 1;
        }
    }
    console.log('\nFlag breakdown:');
    for (const [flag, count] of Object.entries(byFlag)) {
        console.log(`  ${flag}: ${count}`);
    }

    // Step 2: Unmap
    await unmapIngredients(flagged);

    // Step 3: Remap
    const results = await remapIngredients(flagged);

    // Step 4: Write report
    const reportPath = await writeRemapReport(results);

    console.log('\n=== Summary ===');
    console.log(`Processed: ${flagged.length} ingredients`);
    console.log(`Improved: ${results.filter(r => r.improved).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);
    console.log(`Report: ${reportPath}`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
