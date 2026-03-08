#!/usr/bin/env npx tsx
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Clear AI normalize cache for coconut milk queries
    const result = await prisma.aiNormalizeCache.deleteMany({
        where: {
            rawLine: {
                contains: 'coconut milk',
                mode: 'insensitive'
            }
        }
    });
    console.log(`Deleted ${result.count} cached AI normalizations for coconut milk`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

