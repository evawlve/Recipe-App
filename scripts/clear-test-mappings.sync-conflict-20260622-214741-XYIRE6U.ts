import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function clearTestMappings() {
    console.log('Clearing validated mappings for test cases...');

    const deleted = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: {
                in: ['1 cup milk', '1 tsp lemon zest', '1 tbsp vegetable oil spread']
            }
        }
    });

    console.log(`Deleted ${deleted.count} validated mappings`);
    await prisma.$disconnect();
}

clearTestMappings().catch(console.error);
