import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== BLACK OLIVES SERVING DATA (foodId: 6809) ===');
    const olivesServings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '6809' }
    });
    console.log(JSON.stringify(olivesServings.map(s => ({
        servingId: s.servingId,
        desc: s.measurementDescription,
        grams: s.servingWeightGrams,
        isDefault: s.isDefault,
        source: s.source
    })), null, 2));

    console.log('\n=== RED PEPPERS VALIDATED MAPPINGS ===');
    const redPepperMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'red pepper' } }
    });
    console.log(JSON.stringify(redPepperMappings.map(m => ({
        normalized: m.normalizedForm,
        foodName: m.foodName,
        foodId: m.foodId
    })), null, 2));

    console.log('\n=== RED PEPPERS FDC SERVING DATA (AHOLD) ===');
    // The debug output showed winner was FDC food "RED PEPPERS (AHOLD)"
    // Need to find the FDC ID
    const fdcFood = await prisma.fdcFoodCache.findFirst({
        where: { description: { contains: 'RED PEPPERS' } }
    });
    if (fdcFood) {
        console.log('FDC Food found:', fdcFood.description, 'ID:', fdcFood.fdcId);
        const fdcServings = await prisma.fdcServingCache.findMany({
            where: { fdcId: fdcFood.fdcId }
        });
        console.log('Servings:', JSON.stringify(fdcServings.map(s => ({
            servingId: s.servingId,
            desc: s.measurementDescription,
            grams: s.servingWeightGrams,
            source: s.source
        })), null, 2));
    } else {
        console.log('No FDC food found with RED PEPPERS');
    }

    console.log('\n=== BLACK OLIVES VALIDATED MAPPING ===');
    const oliveMapping = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'black olives' } }
    });
    console.log(JSON.stringify(oliveMapping, null, 2));

    await prisma.$disconnect();
}

main().catch(console.error);
