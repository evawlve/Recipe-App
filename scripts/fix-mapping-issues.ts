/**
 * Fix Mapping Issues Script
 * 
 * 1. Delete overestimated AI servings for Oil (450g default)
 * 2. Add synonym for "crushed tomatoes" → prefer canned variant
 * 3. Add synonym for "beef stock cube" → dry bouillon
 * 4. Clear affected ValidatedMappings so they get re-mapped
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Fixing Mapping Issues ===\n');

    // 1. Delete overestimated Oil serving (450g)
    console.log('1. Checking for overestimated Oil servings...');
    const oilFood = await prisma.fatSecretFoodCache.findFirst({
        where: { name: 'Vegetable Oil' }
    });

    if (oilFood) {
        const oilServings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: oilFood.id }
        });

        console.log(`   Found ${oilServings.length} servings for Vegetable Oil:`);
        for (const s of oilServings) {
            console.log(`   - ${s.measurementDescription}: ${s.servingWeightGrams}g (source: ${s.source})`);
        }

        // Delete any AI-estimated serving over 100g (likely overestimated container/bottle serving)
        const overestimated = oilServings.filter(s =>
            s.source === 'ai' && (s.servingWeightGrams ?? 0) > 100
        );

        if (overestimated.length > 0) {
            console.log(`\n   Deleting ${overestimated.length} overestimated AI servings...`);
            for (const s of overestimated) {
                await prisma.fatSecretServingCache.delete({ where: { id: s.id } });
                console.log(`   ✓ Deleted: ${s.measurementDescription} (${s.servingWeightGrams}g)`);
            }
        } else {
            console.log('   No overestimated servings found.');
        }
    } else {
        console.log('   Vegetable Oil not found in cache.');
    }

    // 2. Add synonym for crushed tomatoes → canned
    console.log('\n2. Adding synonym: crushed tomatoes → canned variant...');
    try {
        await prisma.learnedSynonym.upsert({
            where: {
                sourceTerm_targetTerm: {
                    sourceTerm: 'crushed tomatoes',
                    targetTerm: 'crushed tomatoes canned'
                }
            },
            update: {
                confidence: 0.95,
                lastUsedAt: new Date()
            },
            create: {
                sourceTerm: 'crushed tomatoes',
                targetTerm: 'crushed tomatoes canned',
                category: 'ingredient_form',
                source: 'manual',
                confidence: 0.95
            }
        });
        console.log('   ✓ Added synonym: crushed tomatoes → crushed tomatoes canned');
    } catch (error) {
        console.log('   Error:', (error as Error).message);
    }

    // 3. Add synonym for beef stock cube → dry bouillon  
    console.log('\n3. Adding synonym: beef stock cube → dry bouillon...');
    try {
        await prisma.learnedSynonym.upsert({
            where: {
                sourceTerm_targetTerm: {
                    sourceTerm: 'beef stock cube',
                    targetTerm: 'beef bouillon cube'
                }
            },
            update: {
                confidence: 0.95,
                lastUsedAt: new Date()
            },
            create: {
                sourceTerm: 'beef stock cube',
                targetTerm: 'beef bouillon cube',
                category: 'ingredient_form',
                source: 'manual',
                confidence: 0.95
            }
        });
        console.log('   ✓ Added synonym: beef stock cube → beef bouillon cube');

        // Also add for just "beef stock" when followed by "cube"
        await prisma.learnedSynonym.upsert({
            where: {
                sourceTerm_targetTerm: {
                    sourceTerm: 'stock cube',
                    targetTerm: 'bouillon cube'
                }
            },
            update: {
                confidence: 0.95,
                lastUsedAt: new Date()
            },
            create: {
                sourceTerm: 'stock cube',
                targetTerm: 'bouillon cube',
                category: 'ingredient_form',
                source: 'manual',
                confidence: 0.95
            }
        });
        console.log('   ✓ Added synonym: stock cube → bouillon cube');
    } catch (error) {
        console.log('   Error:', (error as Error).message);
    }

    // 4. Clear affected ValidatedMappings so they get re-mapped
    console.log('\n4. Clearing affected ValidatedMappings...');

    const oilMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: 'oil' },
                { rawIngredient: { contains: 'oil', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`   ✓ Deleted ${oilMappings.count} Oil mappings`);

    const tomatoMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'crushed tomato', mode: 'insensitive' } },
                { rawIngredient: { contains: 'crushed tomato', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`   ✓ Deleted ${tomatoMappings.count} Crushed Tomatoes mappings`);

    const stockMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'beef stock', mode: 'insensitive' } },
                { rawIngredient: { contains: 'stock cube', mode: 'insensitive' } },
                { rawIngredient: { contains: 'beef cube', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`   ✓ Deleted ${stockMappings.count} Beef Stock mappings`);

    console.log('\n=== Fix Complete ===');
    console.log('Run debug-full-pipeline.ts to verify fixes work correctly.');

    await prisma.$disconnect();
}

main().catch(console.error);
