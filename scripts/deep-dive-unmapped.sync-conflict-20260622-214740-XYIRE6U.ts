#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Deep Dive: Examining Unmapped Ingredients\n');

    const unmappedIngredients = await prisma.ingredient.findMany({
        where: {
            foodMaps: {
                none: {}
            }
        },
        include: {
            recipe: {
                select: {
                    id: true,
                    title: true
                }
            }
        }
    });

    console.log(`Found ${unmappedIngredients.length} completely unmapped ingredients:\n`);

    unmappedIngredients.forEach((ing, i) => {
        console.log(`${i + 1}. "${ing.name}"`);
        console.log(`   Qty: ${ing.qty} ${ing.unit}`);
        console.log(`   Recipe: "${ing.recipe.title}" (${ing.recipe.id})`);
        console.log(`   Original line: ${ing.qty} ${ing.unit} ${ing.name}`);
        console.log('');
    });

    // Also check for ingredients with mappings but no actual food reference
    const partiallyMapped = await prisma.ingredient.findMany({
        where: {
            foodMaps: {
                some: {}
            }
        },
        include: {
            foodMaps: true,
            recipe: {
                select: {
                    id: true,
                    title: true
                }
            }
        }
    });

    const lowQualityMappings = partiallyMapped.filter(ing =>
        ing.foodMaps.every(m => !m.foodId && !(m as any).fatsecretFoodId && !(m as any).fdcId)
    );

    if (lowQualityMappings.length > 0) {
        console.log(`\n📝 Found ${lowQualityMappings.length} ingredients with foodMaps but no actual food reference:\n`);

        lowQualityMappings.forEach((ing, i) => {
            console.log(`${i + 1}. "${ing.name}"`);
            console.log(`   Qty: ${ing.qty} ${ing.unit}`);
            console.log(`   Recipe: "${ing.recipe.title}"`);
            console.log(`   FoodMaps: ${ing.foodMaps.length} (but all null references)`);
            console.log('');
        });
    }

    // Analysis
    console.log('\n📊 Failure Analysis:\n');

    const allFailedNames = [
        ...unmappedIngredients.map(i => i.name),
        ...lowQualityMappings.map(i => i.name)
    ];

    const issues = {
        has_measurements_in_name: [] as string[],
        very_long_complex: [] as string[],
        parsing_artifacts: [] as string[],
        ambiguous_terms: [] as string[]
    };

    allFailedNames.forEach(name => {
        const lower = name.toLowerCase();

        if (lower.includes('tbsp') || lower.includes('tsp') || lower.includes('cup')) {
            issues.has_measurements_in_name.push(name);
        } else if (name.split(' ').length >= 6) {
            issues.very_long_complex.push(name);
        } else if (lower.includes('yields') || lower.includes('bone and skin removed')) {
            issues.parsing_artifacts.push(name);
        } else if (lower === 'unit' || lower.length <= 3) {
            issues.ambiguous_terms.push(name);
        }
    });

    if (issues.has_measurements_in_name.length > 0) {
        console.log(`❌ Measurements in ingredient name (${issues.has_measurements_in_name.length}):`);
        issues.has_measurements_in_name.forEach(n => console.log(`   - "${n}"`));
        console.log('   💡 Fix: Improve parser to strip measurements from name\n');
    }

    if (issues.very_long_complex.length > 0) {
        console.log(`❌ Very long/complex names (${issues.very_long_complex.length}):`);
        issues.very_long_complex.forEach(n => console.log(`   - "${n}"`));
        console.log('   💡 Fix: Extract core ingredient from complex descriptions\n');
    }

    if (issues.parsing_artifacts.length > 0) {
        console.log(`❌ Parsing artifacts (${issues.parsing_artifacts.length}):`);
        issues.parsing_artifacts.forEach(n => console.log(`   - "${n}"`));
        console.log('   💡 Fix: Better ingredient extraction from recipe text\n');
    }

    if (issues.ambiguous_terms.length > 0) {
        console.log(`❌ Ambiguous/generic terms (${issues.ambiguous_terms.length}):`);
        issues.ambiguous_terms.forEach(n => console.log(`   - "${n}"`));
        console.log('   💡 Fix: Flag these for manual review or use context\n');
    }
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
