/**
 * Cleanup Bad Mappings Script
 * 
 * Identifies and removes ValidatedMapping entries that:
 * 1. Map simple ingredients to processed products (e.g., "chili" → "cream cheese")
 * 2. Have foods with null/invalid macros
 * 3. Are known bad mappings from specific FDC/FatSecret IDs
 */

import { PrismaClient } from '@prisma/client';
import {
    isSimpleIngredientToProcessedMismatch,
    isCategoryMismatch,
} from '@/lib/fatsecret/filter-candidates';

const prisma = new PrismaClient();

// Known bad food IDs to clean up
const KNOWN_BAD_FOOD_IDS = [
    'fdc_2407508',  // Violife chilli peppers cream cheese
];

async function cleanupBadMappings() {
    console.log('=== Cleanup Bad Mappings Script ===\n');

    const dryRun = process.argv.includes('--dry-run');
    if (dryRun) {
        console.log('Running in DRY RUN mode - no changes will be made\n');
    }

    let totalFound = 0;
    let totalDeleted = 0;

    // Step 1: Find mappings with known bad food IDs
    console.log('Step 1: Finding mappings with known bad food IDs...');
    const knownBadMappings = await prisma.validatedMapping.findMany({
        where: {
            foodId: { in: KNOWN_BAD_FOOD_IDS }
        }
    });

    console.log(`Found ${knownBadMappings.length} mappings to known bad foods:`);
    for (const m of knownBadMappings) {
        console.log(`  - "${m.normalizedForm}" → "${m.foodName}" (${m.foodId})`);
    }
    totalFound += knownBadMappings.length;

    if (!dryRun && knownBadMappings.length > 0) {
        const result = await prisma.validatedMapping.deleteMany({
            where: { foodId: { in: KNOWN_BAD_FOOD_IDS } }
        });
        totalDeleted += result.count;
        console.log(`Deleted ${result.count} known bad mappings\n`);
    }

    // Step 2: Find fresh produce terms mapped to processed products
    console.log('\nStep 2: Finding fresh produce mapped to processed products...');

    const freshProduceTerms = [
        'pepper', 'chili', 'chilli', 'chile', 'tomato', 'onion', 'garlic',
        'carrot', 'celery', 'cucumber', 'lettuce', 'spinach', 'basil', 'cilantro',
        'parsley', 'mint', 'strawberry', 'blueberry', 'raspberry', 'lemon', 'lime'
    ];

    const processedIndicators = ['cream cheese', 'spread', 'dip', 'sauce', 'dressing',
        'chips', 'candy', 'jam', 'jelly', 'syrup', 'pie', 'cake'];

    // Build queries to find mismatches
    const potentialBadMappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                // Food name contains processed indicators
                ...processedIndicators.map(ind => ({
                    foodName: { contains: ind, mode: 'insensitive' as const }
                }))
            ]
        }
    });

    const produceToProcessedMismatches: typeof potentialBadMappings = [];
    for (const m of potentialBadMappings) {
        // Check if normalized form is a fresh produce term
        const isFreshProduce = freshProduceTerms.some(term =>
            m.normalizedForm.toLowerCase().includes(term)
        );

        if (isFreshProduce) {
            // Verify using our validation function
            if (isSimpleIngredientToProcessedMismatch(m.normalizedForm, m.foodName, null)) {
                produceToProcessedMismatches.push(m);
            }
        }
    }

    console.log(`Found ${produceToProcessedMismatches.length} fresh produce → processed product mismatches:`);
    for (const m of produceToProcessedMismatches.slice(0, 10)) {
        console.log(`  - "${m.normalizedForm}" → "${m.foodName}"`);
    }
    if (produceToProcessedMismatches.length > 10) {
        console.log(`  ... and ${produceToProcessedMismatches.length - 10} more`);
    }
    totalFound += produceToProcessedMismatches.length;

    if (!dryRun && produceToProcessedMismatches.length > 0) {
        const idsToDelete = produceToProcessedMismatches.map(m => m.id);
        const result = await prisma.validatedMapping.deleteMany({
            where: { id: { in: idsToDelete } }
        });
        totalDeleted += result.count;
        console.log(`Deleted ${result.count} produce → processed mismatches\n`);
    }

    // Step 3: Find mappings with category mismatches
    console.log('\nStep 3: Finding category mismatches...');

    const allMappings = await prisma.validatedMapping.findMany({
        take: 1000,  // Limit for performance
        orderBy: { createdAt: 'desc' }
    });

    const categoryMismatches: typeof allMappings = [];
    for (const m of allMappings) {
        if (isCategoryMismatch(m.normalizedForm, m.foodName)) {
            categoryMismatches.push(m);
        }
    }

    console.log(`Found ${categoryMismatches.length} category mismatches:`);
    for (const m of categoryMismatches.slice(0, 10)) {
        console.log(`  - "${m.normalizedForm}" → "${m.foodName}"`);
    }
    totalFound += categoryMismatches.length;

    if (!dryRun && categoryMismatches.length > 0) {
        const idsToDelete = categoryMismatches.map(m => m.id);
        const result = await prisma.validatedMapping.deleteMany({
            where: { id: { in: idsToDelete } }
        });
        totalDeleted += result.count;
        console.log(`Deleted ${result.count} category mismatches\n`);
    }

    // Summary
    console.log('\n=== Summary ===');
    console.log(`Total bad mappings found: ${totalFound}`);
    if (dryRun) {
        console.log('No changes made (dry run mode)');
        console.log('\nRun without --dry-run to delete these mappings');
    } else {
        console.log(`Total mappings deleted: ${totalDeleted}`);
    }

    await prisma.$disconnect();
}

cleanupBadMappings().catch(console.error);
