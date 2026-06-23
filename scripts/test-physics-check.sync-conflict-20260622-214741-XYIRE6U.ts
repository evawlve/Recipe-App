
import 'dotenv/config';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';

async function main() {
    console.log('--- Testing Physics Sanity Check ---');

    const badCandidate: UnifiedCandidate = {
        id: 'mock-bad-id',
        name: "Strawberry (Tony's) - MOCK",
        score: 10,
        source: 'fatsecret',
        foodType: 'Brand',
        rawData: {
            nutrientsPer100g: {
                calories: 50,
                protein: 0,
                fat: 0,
                carbs: 113 // IMPOSSIBLE > 100
            }
        }
    };

    const goodCandidate: UnifiedCandidate = {
        id: 'mock-good-id',
        name: "Fresh Strawberry",
        score: 10,
        source: 'fatsecret',
        foodType: 'Generic',
        rawData: {
            nutrientsPer100g: {
                calories: 32,
                protein: 0.7,
                fat: 0.3,
                carbs: 7.7
            }
        }
    };

    const candidates = [badCandidate, goodCandidate];
    console.log('Input candidates:', candidates.map(c => `${c.name} (Carbs: ${c.rawData.nutrientsPer100g.carbs}g/100g)`));

    const { filtered } = await filterCandidatesByTokens(candidates, "strawberry", { debug: true });

    const badSurvives = filtered.some(c => c.id === 'mock-bad-id');
    const goodSurvives = filtered.some(c => c.id === 'mock-good-id');

    if (!badSurvives && goodSurvives) {
        console.log('✅ SUCCESS: Physics check rejected the impossible candidate and kept the good one.');
    } else {
        console.error('❌ FAILURE: Physics check failed.');
        console.log('Bad survives?', badSurvives);
        console.log('Good survives?', goodSurvives);
    }
}

main().catch(console.error);
