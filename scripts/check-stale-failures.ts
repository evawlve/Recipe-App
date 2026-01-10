import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    console.log('=== CHECKING FOR STALE ALMOND MILK ENTRIES ===\n');

    // Check ValidatedMapping
    const mapping = await prisma.validatedMapping.findFirst({
        where: {
            rawIngredient: { contains: 'almond milk', mode: 'insensitive' }
        },
    });

    if (mapping) {
        console.log('ValidatedMapping found:');
        console.log('  rawIngredient:', mapping.rawIngredient);
        console.log('  foodId:', mapping.foodId);
        console.log('  foodName:', mapping.foodName);
        console.log('  confidence:', mapping.aiConfidence);
    } else {
        console.log('No ValidatedMapping for almond milk');
    }

    // Check MappingValidationFailure
    const failures = await prisma.mappingValidationFailure.findMany({
        where: {
            rawIngredient: { contains: 'almond milk', mode: 'insensitive' }
        },
    });

    console.log(`\nMappingValidationFailure entries: ${failures.length}`);
    for (const f of failures) {
        console.log(`  - ${f.rawIngredient} -> ${f.failureStage}: ${f.reason}`);
    }
}

check().finally(() => prisma.$disconnect());
