/**
 * Clear garlic mappings from ValidatedMapping cache
 */
import { prisma } from '../src/lib/db';

async function main() {
    const result = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: {
                contains: 'garlic',
                mode: 'insensitive',
            },
        },
    });
    console.log('Cleared', result.count, 'garlic mappings');
    await prisma.$disconnect();
}

main().catch(console.error);
