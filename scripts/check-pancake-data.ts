import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const food = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: 'PANCAKE MIX', mode: 'insensitive' } },
        select: { id: true, name: true }
    });
    console.log('Food:', food);

    if (food) {
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id },
            select: { measurementDescription: true, servingWeightGrams: true }
        });
        console.log('Servings:', servings);
    }
}

check().finally(() => prisma.$disconnect());
