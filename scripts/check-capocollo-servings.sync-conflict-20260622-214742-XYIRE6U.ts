import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'capocollo', mode: 'insensitive' } },
        include: { servings: true },
    });

    console.log('Capocollo foods in cache:', foods.length);
    for (const f of foods) {
        console.log('\n' + f.name + ' (' + (f.brandName || 'generic') + ')');
        for (const s of f.servings) {
            console.log('  -', s.measurementDescription, '=', s.servingWeightGrams, 'g');
        }
    }
    await prisma.$disconnect();
}
check();
