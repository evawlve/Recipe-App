/**
 * Clear poisoned cache entries caused by the "sour cream" → "regular sour cream" rewrite
 * and other affected ingredients from the mapping audit.
 * 
 * What gets cleared:
 * 1. AiNormalizeCache entries with "regular" injected (sour cream variants)
 * 2. ValidatedMapping entries for all affected ingredients from the audit
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🧹 Clearing poisoned cache entries from mapping audit...\n');

    // =================================================================
    // 1. Clear AI normalize cache entries with "regular" from sour cream rewrite
    // =================================================================
    console.log('--- AI Normalize Cache: "regular" sour cream entries ---');
    const aiEntries = await prisma.aiNormalizeCache.findMany({
        where: {
            normalizedKey: { contains: 'regular sour cream' }
        }
    });
    console.log(`  Found ${aiEntries.length} entries to clear:`);
    for (const e of aiEntries) {
        console.log(`    ❌ key="${e.normalizedKey}" => name="${e.normalizedName}"`);
    }
    if (aiEntries.length > 0) {
        const result = await prisma.aiNormalizeCache.deleteMany({
            where: {
                normalizedKey: { contains: 'regular sour cream' }
            }
        });
        console.log(`  ✅ Deleted ${result.count} AI normalize cache entries\n`);
    }

    // =================================================================
    // 2. Clear ValidatedMapping entries for affected ingredients  
    // =================================================================
    const affectedPatterns = [
        // Sour cream variants (affected by "regular" injection)
        'sour cream',
        // Red pepper (now rewrites to red bell pepper)
        'red pepper', 'red bell pepper',
        // Green beans (now rewrites to green string beans)
        'green bean', 'green string bean',
        // Cilantro seeds (now rewrites to coriander seeds)
        'cilantro seed', 'coriander seed',
        // Light/lowfat (all affected by the modifier self-contradiction)
        'light sour cream', 'low fat sour cream', 'reduced fat sour cream',
        'light butter', 'light cream', 'light mayonnaise',
        'low fat cheddar', 'low fat monterey', 'low fat milk',
        'low fat cream', 'velveeta light', 'nonfat mozzarella',
        'light yogurt', 'low fat yogurt', 'skim yogurt',
        'evaporated skim',
        // Okra 
        'okra',
        // Herbs
        'herbs', 'mixed herbs', 'herb',
        // Lentils
        'lentil',
        // Butter (vs nut butter)
        'butter',
        // Baby carrots
        'baby carrot',
        // Wonton
        'wonton',
        // Anaheim pepper
        'anaheim',
    ];

    console.log('--- ValidatedMapping: Affected ingredients ---');
    let totalDeleted = 0;
    for (const pattern of affectedPatterns) {
        const count = await prisma.validatedMapping.count({
            where: {
                normalizedForm: { contains: pattern }
            }
        });
        if (count > 0) {
            const result = await prisma.validatedMapping.deleteMany({
                where: {
                    normalizedForm: { contains: pattern }
                }
            });
            console.log(`  ❌ "${pattern}" → deleted ${result.count} mapping(s)`);
            totalDeleted += result.count;
        }
    }
    console.log(`  ✅ Total ValidatedMapping entries deleted: ${totalDeleted}\n`);

    // =================================================================
    // 3. Also clear AI normalize cache for light/lowfat variants
    // =================================================================
    console.log('--- AI Normalize Cache: light/lowfat variants ---');
    const lightPatterns = [
        'light sour cream', 'light butter', 'light cream',
        'low fat', 'lowfat', 'velveeta light', 'nonfat mozzarella',
        'skim yogurt', 'evaporated skim',
        'green bean', 'green string bean',
        'red pepper', 'red bell pepper',
        'cilantro seed', 'coriander seed',
        'okra', 'lentil', 'herb',
        'baby carrot', 'wonton', 'anaheim',
    ];

    let aiDeleted = 0;
    for (const pattern of lightPatterns) {
        const result = await prisma.aiNormalizeCache.deleteMany({
            where: {
                normalizedKey: { contains: pattern }
            }
        });
        if (result.count > 0) {
            console.log(`  ❌ "${pattern}" → deleted ${result.count} AI cache entries`);
            aiDeleted += result.count;
        }
    }
    console.log(`  ✅ Total AI normalize cache entries deleted: ${aiDeleted}\n`);

    console.log('✅ Cache clearing complete!\n');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
