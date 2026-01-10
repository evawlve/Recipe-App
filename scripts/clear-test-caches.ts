#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';

const termsToClean = [
    'rolled oats',
    'vegetable spread',
    'fat spread',
    'pudding',
];

async function main() {
    let totalDeleted = 0;
    
    for (const term of termsToClean) {
        // Clear AI normalize cache
        const aiResult = await prisma.aiNormalizeCache.deleteMany({
            where: {
                rawLine: { contains: term, mode: 'insensitive' }
            }
        });
        
        // Clear validated mappings
        const vmResult = await prisma.validatedMapping.deleteMany({
            where: {
                rawIngredient: { contains: term, mode: 'insensitive' }
            }
        });
        
        if (aiResult.count > 0 || vmResult.count > 0) {
            console.log(`${term}: cleared ${aiResult.count} AI cache + ${vmResult.count} validated mappings`);
            totalDeleted += aiResult.count + vmResult.count;
        }
    }
    
    console.log(`\nTotal cleared: ${totalDeleted} entries`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

