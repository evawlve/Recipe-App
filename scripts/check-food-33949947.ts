import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkFood() {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: '33949947' },
        include: { servings: true }
    });

    if (food) {
        console.log('=== Food ID 33949947 ===');
        console.log('Name:', food.name);
        console.log('Brand:', food.brandName);
        console.log('\nServings:');
        for (const s of food.servings) {
            console.log(`  - ${s.measurementDescription} (${s.servingWeightGrams}g, isVolume: ${s.isVolume})`);
        }
    } else {
        console.log('Food not found');
    }

    await prisma.$disconnect();
}

checkFood().catch(console.error);
