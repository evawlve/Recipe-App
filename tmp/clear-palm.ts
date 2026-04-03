import { prisma } from '../src/lib/db';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

async function main() {
    const rawLine = "Palm Sugar";
    const { cleaned: normalized } = normalizeIngredientName(rawLine);
    
    await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'palm sugar', mode: 'insensitive' } },
                { normalizedForm: { contains: 'palm sugar', mode: 'insensitive' } }
            ]
        }
    });
    console.log("Cleared Palm Sugar from cache");
}

main().catch(console.error).finally(() => prisma.$disconnect());
