#!/usr/bin/env ts-node
/**
 * Test the FDC size qualifier handling directly (bypassing cache)
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { getOrCreateFdcSizeServings, isSizeQualifier } from '../src/lib/usda/fdc-ai-backfill';

async function main() {
    console.log('\n🔍 Testing FDC Size Qualifier AI Backfill\n');

    // Test the isSizeQualifier function
    console.log('Testing isSizeQualifier:');
    console.log(`  "medium" -> ${isSizeQualifier('medium')}`);
    console.log(`  "small" -> ${isSizeQualifier('small')}`);
    console.log(`  "large" -> ${isSizeQualifier('large')}`);
    console.log(`  "cup" -> ${isSizeQualifier('cup')}`);
    console.log(`  undefined -> ${isSizeQualifier(undefined)}`);

    // Find an FDC potato entry (if it exists)
    const fdcPotato = await prisma.fdcFoodCache.findFirst({
        where: {
            description: { contains: 'potato', mode: 'insensitive' },
            dataType: 'Foundation',  // USDA Foundation foods have raw produce
        },
        include: { servings: true },
    });

    if (fdcPotato) {
        console.log(`\n Found FDC potato: "${fdcPotato.description}" (ID: ${fdcPotato.id})`);
        console.log(`Existing servings: ${fdcPotato.servings.map(s => `${s.description}=${s.grams}g`).join(', ') || 'none'}`);

        // Test the size backfill
        console.log('\n🔧 Calling getOrCreateFdcSizeServings...');
        const sizes = await getOrCreateFdcSizeServings(fdcPotato.id, fdcPotato.description);

        if (sizes) {
            console.log('✅ Size estimates:');
            console.log(`   Small: ${sizes.small}g`);
            console.log(`   Medium: ${sizes.medium}g`);
            console.log(`   Large: ${sizes.large}g`);

            // Verify they're now in the cache
            const updatedServings = await prisma.fdcServingCache.findMany({
                where: { fdcId: fdcPotato.id },
            });
            console.log(`\n📊 Cached servings after backfill: ${updatedServings.length}`);
            for (const s of updatedServings) {
                console.log(`   - "${s.description}" = ${s.grams}g (source: ${s.source})`);
            }
        } else {
            console.log('❌ Size estimation failed');
        }
    } else {
        console.log('❌ No FDC potato entry found in cache. Try running FDC sync first.');

        // List what FDC foods we have
        const fdcFoods = await prisma.fdcFoodCache.findMany({ take: 10 });
        console.log(`\nAvailable FDC foods (first 10): ${fdcFoods.map(f => f.description).join(', ') || 'none'}`);
    }

    console.log('\n✅ Done');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
