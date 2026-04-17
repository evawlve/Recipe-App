import { prisma } from '../src/lib/db';

async function main() {
    console.log('Clearing all AI Generated Food records due to prompt bug...');
    
    // Clear ValidatedMappings born from AI fallback
    const deletedMappings = await prisma.validatedMapping.deleteMany({
        where: { source: 'ai_generated' }
    });
    console.log(`Deleted ${deletedMappings.count} cached ValidatedMappings (AI generated source).`);

    // Servings should cascade, but let's delete them explicitly if not
    try {
        const deletedServings = await prisma.aiGeneratedServing.deleteMany({});
        console.log(`Deleted ${deletedServings.count} AI Generated Servings.`);
    } catch (e) {
        console.log('Servings table might not exist or constraint error:', e);
    }

    // Delete base AI foods
    const deletedFoods = await prisma.aiGeneratedFood.deleteMany({});
    console.log(`Deleted ${deletedFoods.count} AI Generated Foods.`);

    console.log('AI cache successfully purged.');
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
