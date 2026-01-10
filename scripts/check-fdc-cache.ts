import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: 'fdc_173590' },
        select: { id: true, name: true, nutrientsPer100g: true },
    });
    console.log(food ? `Found: ${food.name}, nutrients: ${JSON.stringify(food.nutrientsPer100g)}` : 'NOT FOUND');
}
check().finally(() => prisma.$disconnect());
