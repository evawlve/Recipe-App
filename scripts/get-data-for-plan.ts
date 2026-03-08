
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';

async function main() {
    // 1. Get STRAWBERRY (TONY'S) ID
    console.log('--- Finding Strawberry ID ---');
    // We assume the bad mapping is in ValidatedMapping
    const mapping = await prisma.validatedMapping.findFirst({
        where: {
            rawIngredient: { contains: "stberry" }
        }
    });

    if (mapping) {
        console.log(`FOUND Bad Strawberry ID: ${mapping.foodId}`);
        console.log(`Name: ${mapping.foodName}`);
        console.log(`Brand: ${mapping.brandName}`);
    } else {
        console.log('Mapping not found in ValidatedMapping. Searching FoodCache...');
        const food = await prisma.fatSecretFoodCache.findFirst({
            where: {
                name: { contains: "STRAWBERRY", mode: 'insensitive' },
                brandName: { contains: "TONY'S", mode: 'insensitive' }
            }
        });
        if (food) {
            console.log(`FOUND Bad Strawberry ID (via cache): ${food.id}`);
        } else {
            console.log('Could not find Bad Strawberry!');
        }
    }

    // 2. Score Egg Beaters
    console.log('\n--- Scoring Egg Beaters ---');
    const query = "egg beaters";
    // We need actual candidates to score
    const candidates = await gatherCandidates(query, null, query, { skipCache: true, skipFdc: true });

    if (candidates.length > 0) {
        const rerankCandidates = candidates.map(toRerankCandidate);
        const result = simpleRerank(query, rerankCandidates);

        console.log('Winner:', result?.winner.name);
        console.log('Reason:', result?.reason);

        // Manually inspect the "Egg Beaters" candidate vs "Scrambled Egg"
        const eggBeaters = rerankCandidates.find(c => c.brandName?.toLowerCase().includes('egg beaters') || c.name.toLowerCase().includes('egg beaters'));
        const scrambled = rerankCandidates.find(c => c.name.toLowerCase().includes('scrambled'));

        if (eggBeaters) {
            // We can't call computeSimpleScore easily as it's not exported, but we can infer or copy logic if needed.
            // Or just look at the result.
            console.log(`\nEgg Beaters Candidate: ${eggBeaters.name} (Brand: ${eggBeaters.brandName})`);
            console.log(`Score (from gather): ${eggBeaters.score}`);
        }
        if (scrambled) {
            console.log(`\nScrambled Candidate: ${scrambled.name}`);
            console.log(`Score (from gather): ${scrambled.score}`);
        }
    }

}

main().catch(console.error).finally(() => prisma.$disconnect());
