import { prisma } from './src/lib/db';

async function query() {
    const records = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'egg' } },
                { rawIngredient: { contains: 'onion' } },
                { rawIngredient: { contains: 'pepper' } }
            ]
        },
        select: {
            rawIngredient: true,
            normalizedForm: true,
            foodName: true,
            source: true
        },
        take: 100
    });
    const lines = records.map(r => `${r.rawIngredient} -> ${r.normalizedForm} | ${r.foodName}`);
    require('fs').writeFileSync('tmp-mapping.txt', lines.join('\n'));
}

query().catch(console.error).finally(() => process.exit(0));
