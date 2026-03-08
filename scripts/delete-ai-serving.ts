/**
 * Delete AI-Estimated Serving Script
 * 
 * Usage:
 *   npx tsx scripts/delete-ai-serving.ts --id <serving-id>
 *   npx tsx scripts/delete-ai-serving.ts --foodId 12345 --desc "1 cup"
 *   npx tsx scripts/delete-ai-serving.ts --foodId fdc_789 --all-ai
 * 
 * Options:
 *   --id <id>          Delete by specific serving ID
 *   --foodId <id>      Target food ID (required with --desc or --all-ai)
 *   --desc <desc>      Delete serving matching description
 *   --all-ai           Delete all AI-estimated servings for the food
 *   --dry-run          Show what would be deleted without deleting
 */

import { prisma } from '../src/lib/db';

async function main() {
    const args = process.argv.slice(2);

    let servingId: string | null = null;
    let foodId: string | null = null;
    let desc: string | null = null;
    let allAi = false;
    let dryRun = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--id' && args[i + 1]) {
            servingId = args[++i];
        } else if (args[i] === '--foodId' && args[i + 1]) {
            foodId = args[++i];
        } else if (args[i] === '--desc' && args[i + 1]) {
            desc = args[++i];
        } else if (args[i] === '--all-ai') {
            allAi = true;
        } else if (args[i] === '--dry-run') {
            dryRun = true;
        }
    }

    if (!servingId && !foodId) {
        console.log('Usage: npx tsx scripts/delete-ai-serving.ts [options]');
        console.log('  --id <id>          Delete by specific serving ID');
        console.log('  --foodId <id>      Target food ID');
        console.log('  --desc <desc>      Delete serving matching description');
        console.log('  --all-ai           Delete all AI-estimated servings for the food');
        console.log('  --dry-run          Show what would be deleted');
        process.exit(1);
    }

    // Determine source
    const isFdc = foodId?.startsWith('fdc_');

    if (servingId) {
        // Delete by ID - try both tables
        const fsServing = await prisma.fatSecretServingCache.findUnique({
            where: { id: servingId }
        });

        if (fsServing) {
            console.log(`Found FatSecret serving: ${fsServing.measurementDescription} (${fsServing.servingWeightGrams}g)`);
            if (!dryRun) {
                await prisma.fatSecretServingCache.delete({ where: { id: servingId } });
                console.log('✓ Deleted');
            } else {
                console.log('[DRY RUN] Would delete');
            }
            return;
        }

        const fdcServing = await prisma.fdcServingCache.findUnique({
            where: { id: servingId }
        });

        if (fdcServing) {
            console.log(`Found FDC serving: ${fdcServing.measurementDescription} (${fdcServing.servingWeightGrams}g)`);
            if (!dryRun) {
                await prisma.fdcServingCache.delete({ where: { id: servingId } });
                console.log('✓ Deleted');
            } else {
                console.log('[DRY RUN] Would delete');
            }
            return;
        }

        console.log('Serving not found with ID:', servingId);
        return;
    }

    if (foodId) {
        if (isFdc) {
            const fdcId = parseInt(foodId.replace('fdc_', ''));

            const where: any = { fdcId };
            if (allAi) where.isAiEstimated = true;
            if (desc) where.measurementDescription = { contains: desc, mode: 'insensitive' };

            const servings = await prisma.fdcServingCache.findMany({ where });

            console.log(`Found ${servings.length} FDC servings to delete:`);
            servings.forEach(s => {
                console.log(`  - ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : ''}`);
            });

            if (!dryRun && servings.length > 0) {
                const result = await prisma.fdcServingCache.deleteMany({ where });
                console.log(`✓ Deleted ${result.count} servings`);
            } else if (dryRun) {
                console.log('[DRY RUN] Would delete');
            }
        } else {
            const where: any = { foodId };
            if (allAi) where.isAiEstimated = true;
            if (desc) where.measurementDescription = { contains: desc, mode: 'insensitive' };

            const servings = await prisma.fatSecretServingCache.findMany({ where });

            console.log(`Found ${servings.length} FatSecret servings to delete:`);
            servings.forEach(s => {
                console.log(`  - ${s.measurementDescription}: ${s.servingWeightGrams}g ${s.isAiEstimated ? '[AI]' : ''}`);
            });

            if (!dryRun && servings.length > 0) {
                const result = await prisma.fatSecretServingCache.deleteMany({ where });
                console.log(`✓ Deleted ${result.count} servings`);
            } else if (dryRun) {
                console.log('[DRY RUN] Would delete');
            }
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
