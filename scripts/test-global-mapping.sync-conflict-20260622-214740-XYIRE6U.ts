#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';

async function main() {
    console.log('\n🧪 Testing Global Mapping System\n');

    // 1. Create a dummy recipe with a common ingredient
    const testIngredientName = "test banana " + Date.now(); // Unique name to avoid existing maps

    // Actually, we want to test the GLOBAL mapping, so we should use a real name that will map successfully
    // but we want to verify it gets saved to global.
    // Let's use "banana" but we need to make sure it's not already mapped in this specific recipe context?
    // No, autoMap checks unmapped ingredients.

    // Let's create a temporary recipe
    const user = await prisma.user.findFirst();
    if (!user) throw new Error('No user found');

    const recipe = await prisma.recipe.create({
        data: {
            title: 'Global Mapping Test Recipe',
            authorId: user.id,
            bodyMd: 'Test',
            ingredients: {
                create: [
                    { name: 'banana', qty: 1, unit: 'medium' },
                    { name: 'avocado', qty: 1, unit: 'whole' }
                ]
            }
        }
    });

    console.log(`Created test recipe: ${recipe.id}`);

    try {
        // 2. Run Auto-Map (First Pass)
        console.log('\nRunning 1st Pass Auto-Map...');
        const start1 = Date.now();
        await autoMapIngredients(recipe.id);
        const time1 = Date.now() - start1;
        console.log(`1st Pass took ${time1}ms`);

        // 3. Verify Global Mapping Creation
        const bananaGlobal = await (prisma as any).globalIngredientMapping.findFirst({
            where: { normalizedName: 'banana' }
        });

        if (bananaGlobal) {
            console.log('✅ Global mapping created for "banana"');
            console.log(bananaGlobal);
        } else {
            console.error('❌ Global mapping NOT created for "banana"');
        }

        // 4. Create another recipe with same ingredients to test Cache Hit
        const recipe2 = await prisma.recipe.create({
            data: {
                title: 'Global Mapping Test Recipe 2',
                authorId: user.id,
                bodyMd: 'Test',
                ingredients: {
                    create: [
                        { name: 'banana', qty: 2, unit: 'medium' } // Same ingredient
                    ]
                }
            }
        });

        console.log(`\nCreated test recipe 2: ${recipe2.id}`);

        // 5. Run Auto-Map (Second Pass - Should hit Global Cache)
        console.log('Running 2nd Pass Auto-Map...');
        const start2 = Date.now();
        await autoMapIngredients(recipe2.id);
        const time2 = Date.now() - start2;
        console.log(`2nd Pass took ${time2}ms`);

        if (time2 < time1) {
            console.log(`✅ 2nd pass was faster (${time1}ms vs ${time2}ms)`);
        } else {
            console.log(`⚠️ 2nd pass was not significantly faster (might be network variance or overhead)`);
        }

        // Verify usage count increment
        const bananaGlobalAfter = await (prisma as any).globalIngredientMapping.findFirst({
            where: { normalizedName: 'banana' }
        });

        if (bananaGlobalAfter && bananaGlobalAfter.usageCount > bananaGlobal.usageCount) {
            console.log(`✅ Usage count incremented: ${bananaGlobal.usageCount} -> ${bananaGlobalAfter.usageCount}`);
        } else {
            console.error(`❌ Usage count NOT incremented`);
        }

        // Cleanup
        await prisma.recipe.delete({ where: { id: recipe.id } });
        await prisma.recipe.delete({ where: { id: recipe2.id } });
        console.log('\nCleaned up test recipes.');

    } catch (e) {
        console.error('Test failed:', e);
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
