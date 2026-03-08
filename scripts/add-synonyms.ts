/**
 * Add LearnedSynonym entries to fix search expansion
 */
import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Adding LearnedSynonym Entries ===\n');

    // Delete any existing entries first
    await prisma.learnedSynonym.deleteMany({
        where: { sourceTerm: { in: ['red pepper flakes', 'pepper flakes'] } }
    });

    // Red pepper flakes -> crushed red pepper
    await prisma.learnedSynonym.create({
        data: {
            sourceTerm: 'red pepper flakes',
            targetTerm: 'crushed red pepper',
            locale: 'en',
            category: 'spice',
            source: 'manual',
            confidence: 1.0,
            useCount: 1,
            successCount: 1,
            failureCount: 0
        }
    });
    console.log('Created: red pepper flakes -> crushed red pepper');

    // Pepper flakes -> crushed pepper  
    await prisma.learnedSynonym.create({
        data: {
            sourceTerm: 'pepper flakes',
            targetTerm: 'crushed red pepper',
            locale: 'en',
            category: 'spice',
            source: 'manual',
            confidence: 1.0,
            useCount: 1,
            successCount: 1,
            failureCount: 0
        }
    });
    console.log('Created: pepper flakes -> crushed red pepper');

    console.log('\n✅ Complete!');
    await prisma.$disconnect();
}

main();
