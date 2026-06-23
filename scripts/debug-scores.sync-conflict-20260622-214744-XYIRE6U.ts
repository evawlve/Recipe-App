
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { scoreCandidate } from '../src/lib/fatsecret/score-candidate';

async function main() {
    // 1. Get Strawberry ID
    const mapping = await prisma.validatedMapping.findFirst({
        where: {
            rawIngredient: { contains: "stberry" },
            foodName: { contains: "TONY'S" }
        }
    });
    if (mapping) {
        console.log(`\nBAD FOOD ID: ${mapping.foodId} ("${mapping.foodName}")`);
    } else {
        console.log('Use query to find it directly in FoodCache if mapping missing...');
        const food = await prisma.fatSecretFoodCache.findFirst({
            where: { name: "STRAWBERRY", brandName: "TONY'S" }
        });
        if (food) console.log(`BAD FOOD ID: ${food.id} (found via cache match)`);
    }

    // 2. Score Egg Beaters
    const query = "egg beaters";
    const candidates = await gatherCandidates(query);

    console.log('\n--- Egg Beaters Scoring ---');
    candidates.slice(0, 5).forEach(c => {
        const score = scoreCandidate(c, query);
        console.log(`\nCandidate: ${c.name} (${c.brandName})`);
        console.log(`Score: ${score.finalScore.toFixed(3)}`);
        console.log(`Matches: Name=${score.nameMatch.toFixed(2)}, Brand=${score.brandMatch}`);
        console.log(`Penalties: Brand=${score.brandPenalty}`);
    });
}

main().catch(console.error).finally(() => prisma.$disconnect());
