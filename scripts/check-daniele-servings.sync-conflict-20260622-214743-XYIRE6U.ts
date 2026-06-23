import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    // Check what servings Capocollo (Daniele) - foodId 4445238 - has
    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '4445238' }
    });
    console.log('Servings for Capocollo (Daniele) ID 4445238:');
    for (const s of servings) {
        console.log('  -', s.measurementDescription, '=', s.servingWeightGrams, 'g (source:', s.source || 'fatsecret', ')');
    }
    await prisma.$disconnect();
}
check();
