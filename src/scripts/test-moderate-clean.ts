// Test moderate mapping issues - cleaner output
process.env.LOG_LEVEL = 'error';

import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const testCases = [
        { line: '0.5 cup cornmeal', expected: 'Cornmeal (plain)', issue: 'prepared dish mismatch' },
        { line: '1.5 cup milk lowfat', expected: 'Lowfat Milk', issue: 'fat modifier mismatch' },
        { line: 'green bell pepper', expected: 'Green Bell Pepper', issue: 'color mismatch' },
        { line: '3 tbsp 100% liquid', expected: 'Water (0 cal)', issue: 'ambiguous query' },
    ];

    console.log('=== MODERATE ISSUE ANALYSIS ===\n');

    for (const { line, expected, issue } of testCases) {
        console.log(`\n--- ${issue.toUpperCase()} ---`);
        console.log(`Input: "${line}"`);
        console.log(`Expected: ${expected}`);

        const parsed = parseIngredientLine(line);
        console.log(`Parsed name: "${parsed?.name}"`);

        const result = await mapIngredientWithFallback(line, {
            minConfidence: 0,
            skipFdc: true,
        });

        if (result) {
            console.log(`Got: ${result.foodName} (${result.brandName || 'Generic'})`);
            console.log(`Kcal: ${result.kcal.toFixed(0)}, Grams: ${result.grams.toFixed(1)}g`);

            const isCorrect = result.foodName.toLowerCase().includes(parsed?.name?.split(' ')[0]?.toLowerCase() || '');
            console.log(`Status: ${isCorrect ? '✅' : '⚠️ MISMATCH'}`);
        } else {
            console.log('Got: No result');
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
