/**
 * Re-Mapping Comparison and Audit Tool
 * 
 * This script:
 * 1. Exports ALL current mappings to a condensed analysis file
 * 2. Re-runs a sample through the improved pipeline and compares
 * 3. Identifies false positives, incorrect servings, and improvements
 * 
 * What gets cleared vs preserved when "unmapping":
 * 
 * CLEARED (mapping data):
 *   - IngredientFoodMap: Per-ingredient mapping to foods (this is what "unmapping" clears)
 *   - ValidatedMapping: Cached validated raw→food mappings
 * 
 * PRESERVED (learned + cached data):
 *   - FatSecretFoodCache: Cached food data from API (expensive to re-fetch)
 *   - FatSecretServingCache: Cached serving data
 *   - LearnedSynonym: AI-learned synonyms (valuable, improves over time)
 *   - AiNormalizeCache: AI-learned normalizations
 *   - IngredientCleanupPattern: Learned cleanup patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const LOG_DIR = path.join(__dirname, '..', 'logs');

interface MappingAuditEntry {
    ingredientId: string;
    rawLine: string;
    currentFoodId: string | null;
    currentFoodName: string | null;
    currentGrams: number | null;
    currentConfidence: number | null;
    currentServingDesc: string | null;
    flags: string[];
}

// Flags for issues we want to detect
function detectIssues(entry: {
    rawLine: string;
    foodName: string | null;
    grams: number | null;
    confidence: number | null;
}): string[] {
    const flags: string[] = [];
    const raw = entry.rawLine.toLowerCase();
    const food = (entry.foodName || '').toLowerCase();

    // High calorie check (based on grams)
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

async function exportAllMappings(): Promise<MappingAuditEntry[]> {
    console.log('Fetching all ingredient mappings...');

    const mappings = await prisma.ingredientFoodMap.findMany({
        where: { fatsecretFoodId: { not: null } },
        include: {
            ingredient: {
                select: { id: true, name: true, qty: true, unit: true }
            }
        },
        orderBy: { createdAt: 'desc' }
    });

    const entries: MappingAuditEntry[] = [];

    for (const m of mappings) {
        // Get food name from cache
        let foodName: string | null = null;
        if (m.fatsecretFoodId) {
            const food = await prisma.fatSecretFoodCache.findUnique({
                where: { id: m.fatsecretFoodId },
                select: { name: true, brandName: true }
            });
            foodName = food ? (food.brandName ? `${food.name} (${food.brandName})` : food.name) : m.fatsecretFoodId;
        }

        // Get serving description
        let servingDesc: string | null = null;
        if (m.fatsecretServingId) {
            const serving = await prisma.fatSecretServingCache.findUnique({
                where: { id: m.fatsecretServingId },
                select: { measurementDescription: true }
            });
            servingDesc = serving?.measurementDescription || null;
        }

        const rawLine = `${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}`.trim();

        const entry: MappingAuditEntry = {
            ingredientId: m.ingredientId,
            rawLine,
            currentFoodId: m.fatsecretFoodId,
            currentFoodName: foodName,
            currentGrams: m.fatsecretGrams,
            currentConfidence: m.fatsecretConfidence,
            currentServingDesc: servingDesc,
            flags: detectIssues({
                rawLine,
                foodName,
                grams: m.fatsecretGrams,
                confidence: m.fatsecretConfidence,
            }),
        };

        entries.push(entry);
    }

    return entries;
}

async function writeAuditFile(entries: MappingAuditEntry[]) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `mapping-audit-${timestamp}.txt`;
    const filepath = path.join(LOG_DIR, filename);

    const lines: string[] = [
        '# Mapping Audit - All Current Mappings',
        `# Generated: ${new Date().toISOString()}`,
        `# Total Mappings: ${entries.length}`,
        '#',
        '# Format: [CONF] "Raw Ingredient" → "Mapped Food" | (grams) [FLAGS]',
        '#',
    ];

    // Summary stats
    const flagged = entries.filter(e => e.flags.length > 0);
    const highConf = entries.filter(e => (e.currentConfidence || 0) >= 0.8);
    const medConf = entries.filter(e => (e.currentConfidence || 0) >= 0.5 && (e.currentConfidence || 0) < 0.8);

    lines.push(`# High confidence (≥0.8): ${highConf.length}`);
    lines.push(`# Medium confidence (0.5-0.8): ${medConf.length}`);
    lines.push(`# Flagged for review: ${flagged.length}`);
    lines.push('#');
    lines.push('');

    // Group by flags
    const byFlag: Record<string, MappingAuditEntry[]> = {};
    for (const e of entries) {
        for (const flag of e.flags) {
            if (!byFlag[flag]) byFlag[flag] = [];
            byFlag[flag].push(e);
        }
    }

    // Write flagged entries first, grouped by flag
    for (const [flag, flagEntries] of Object.entries(byFlag)) {
        lines.push(`\n## ${flag} (${flagEntries.length} entries)\n`);
        for (const e of flagEntries.slice(0, 20)) { // Limit to 20 per flag
            const conf = (e.currentConfidence || 0).toFixed(2);
            const grams = e.currentGrams ? `${e.currentGrams}g` : '?g';
            const serving = e.currentServingDesc ? ` (${e.currentServingDesc})` : '';
            lines.push(`⚠ [${conf}] "${e.rawLine}" → "${e.currentFoodName}"${serving} | ${grams} [${e.flags.join(', ')}]`);
        }
        if (flagEntries.length > 20) {
            lines.push(`  ... and ${flagEntries.length - 20} more with ${flag}`);
        }
    }

    // Write all entries (condensed)
    lines.push('\n## All Mappings\n');
    for (const e of entries) {
        const conf = (e.currentConfidence || 0).toFixed(2);
        const grams = e.currentGrams ? `${e.currentGrams}g` : '?g';
        const serving = e.currentServingDesc ? ` (${e.currentServingDesc})` : '';
        const flagStr = e.flags.length > 0 ? ` [${e.flags.join(', ')}]` : '';
        const symbol = e.flags.length > 0 ? '⚠' : '✓';
        lines.push(`${symbol} [${conf}] "${e.rawLine}" → "${e.currentFoodName}"${serving} | ${grams}${flagStr}`);
    }

    fs.writeFileSync(filepath, lines.join('\n'), 'utf-8');
    console.log(`\nAudit file written: ${filepath}`);
    return filepath;
}

interface RemapComparison {
    rawLine: string;
    oldFood: string | null;
    oldGrams: number | null;
    newFood: string | null;
    newGrams: number | null;
    changed: boolean;
    improvement: string | null;
}

async function runRemapSample(sampleSize: number = 50): Promise<RemapComparison[]> {
    console.log(`\nRunning re-mapping test on ${sampleSize} samples...`);

    // Get a diverse sample: some flagged, some high-conf
    const flaggedMappings = await prisma.ingredientFoodMap.findMany({
        where: { fatsecretConfidence: { lt: 0.7 } },
        include: { ingredient: true },
        take: Math.floor(sampleSize / 2),
    });

    const highConfMappings = await prisma.ingredientFoodMap.findMany({
        where: { fatsecretConfidence: { gte: 0.8 } },
        include: { ingredient: true },
        take: Math.floor(sampleSize / 2),
    });

    const samples = [...flaggedMappings, ...highConfMappings];
    const comparisons: RemapComparison[] = [];

    for (let i = 0; i < samples.length; i++) {
        const m = samples[i];
        const rawLine = `${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}`.trim();

        process.stdout.write(`\r  Processing ${i + 1}/${samples.length}: ${rawLine.slice(0, 40)}...`);

        // Get current food name
        let oldFood: string | null = null;
        if (m.fatsecretFoodId) {
            const food = await prisma.fatSecretFoodCache.findUnique({
                where: { id: m.fatsecretFoodId },
                select: { name: true }
            });
            oldFood = food?.name || m.fatsecretFoodId;
        }

        // Run new mapping
        try {
            const newResult = await mapIngredientWithFallback(rawLine, { skipCache: true });

            const comparison: RemapComparison = {
                rawLine,
                oldFood,
                oldGrams: m.fatsecretGrams,
                newFood: newResult?.foodName || null,
                newGrams: newResult?.grams || null,
                changed: false,
                improvement: null,
            };

            // Detect changes
            if (newResult) {
                const foodChanged = newResult.foodName !== oldFood;
                const gramsChanged = Math.abs((newResult.grams || 0) - (m.fatsecretGrams || 0)) > 5;

                comparison.changed = foodChanged || gramsChanged;

                if (comparison.changed) {
                    // Analyze if it's an improvement
                    if (m.fatsecretGrams && m.fatsecretGrams > 300 && newResult.grams && newResult.grams < 100) {
                        comparison.improvement = 'FIXED_HIGH_GRAMS';
                    } else if (foodChanged && newResult.confidence > (m.fatsecretConfidence || 0)) {
                        comparison.improvement = 'BETTER_MATCH';
                    } else if (gramsChanged) {
                        comparison.improvement = 'SERVING_CHANGED';
                    }
                }
            }

            comparisons.push(comparison);
        } catch (err) {
            console.error(`\n  Error mapping "${rawLine}": ${(err as Error).message}`);
        }
    }

    console.log('\n');
    return comparisons;
}

async function main() {
    console.log('\n=== Mapping Audit & Re-Map Test ===\n');

    // Step 1: Export all current mappings
    const entries = await exportAllMappings();
    const auditPath = await writeAuditFile(entries);

    // Step 2: Run re-mapping sample
    const comparisons = await runRemapSample(50);

    // Step 3: Summary
    const changed = comparisons.filter(c => c.changed);
    const improved = comparisons.filter(c => c.improvement);

    console.log('\n=== Re-Mapping Summary ===\n');
    console.log(`Tested: ${comparisons.length} ingredients`);
    console.log(`Changed: ${changed.length} (${(changed.length / comparisons.length * 100).toFixed(1)}%)`);
    console.log(`Improved: ${improved.length}`);

    if (changed.length > 0) {
        console.log('\nSample changes:');
        for (const c of changed.slice(0, 10)) {
            console.log(`  "${c.rawLine}"`);
            console.log(`    Old: ${c.oldFood} (${c.oldGrams}g)`);
            console.log(`    New: ${c.newFood} (${c.newGrams}g)`);
            if (c.improvement) console.log(`    → ${c.improvement}`);
        }
    }

    console.log(`\nFull audit: ${auditPath}`);

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
