import 'dotenv/config';
import { fdcApi } from '../src/lib/usda/fdc-api';

// Replicate the computeFdcScore logic to debug
function computeFdcScore(query: string, fdcDescription: string, dataType: string): number {
    const queryLower = query.toLowerCase();
    const descLower = fdcDescription.toLowerCase();

    console.log(`  Query: "${queryLower}"`);
    console.log(`  Desc: "${descLower}"`);

    const FDC_FAT_FREE_TERMS = ['fat free', 'fat-free', 'nonfat', 'non-fat'];
    const FDC_REDUCED_FAT_TERMS = ['reduced fat', 'low fat', 'lowfat', 'low-fat', 'lite', 'light'];

    const queryWantsFatFree = FDC_FAT_FREE_TERMS.some(t => queryLower.includes(t));
    const fdcHasFatFree = FDC_FAT_FREE_TERMS.some(t => descLower.includes(t));
    const fdcHasReducedFat = FDC_REDUCED_FAT_TERMS.some(t => descLower.includes(t));

    console.log(`  queryWantsFatFree: ${queryWantsFatFree}`);
    console.log(`  fdcHasFatFree: ${fdcHasFatFree}`);
    console.log(`  fdcHasReducedFat: ${fdcHasReducedFat}`);

    // Token matching
    const modifierTokens = new Set([
        'fat', 'free', 'nonfat', 'lowfat', 'reduced', 'low', 'or',
        'unsweetened', 'sweetened', 'sugar', 'light', 'lite',
    ]);

    const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 2 && !modifierTokens.has(t));
    const descTokens = descLower.split(/[\s,]+/).filter(t => t.length > 2 && !modifierTokens.has(t));

    console.log(`  queryTokens: [${queryTokens.join(', ')}]`);
    console.log(`  descTokens: [${descTokens.join(', ')}]`);

    let matchCount = 0;
    for (const qt of queryTokens) {
        if (descTokens.some(dt => dt.includes(qt) || qt.includes(dt))) {
            matchCount++;
        }
    }

    let score = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
    console.log(`  Base token score: ${score.toFixed(3)} (${matchCount}/${queryTokens.length} matches)`);

    // Modifier bonus
    if (queryWantsFatFree) {
        if (fdcHasFatFree) {
            score *= 1.4;
            console.log(`  Fat-free MATCH bonus: score × 1.4 = ${score.toFixed(3)}`);
        } else if (fdcHasReducedFat) {
            score *= 0.3;
            console.log(`  Fat-free MISMATCH (is reduced): score × 0.3 = ${score.toFixed(3)}`);
        } else {
            score *= 0.5;
            console.log(`  Fat-free MISSING: score × 0.5 = ${score.toFixed(3)}`);
        }
    }

    // Data type boost
    const isHighQuality = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'].some(t => dataType.includes(t));
    if (isHighQuality) {
        score = Math.min(1.0, score * 1.3);
        console.log(`  SR Legacy boost: score × 1.3 = ${score.toFixed(3)}`);
    }

    console.log(`  FINAL SCORE: ${score.toFixed(3)}`);
    return score;
}

async function debugFdcScoring() {
    const query = 'fat free cheddar cheese';
    console.log(`\n=== Debugging FDC Scoring for: "${query}" ===\n`);

    const results = await fdcApi.searchFoods({ query, pageSize: 5 });
    if (results?.foods?.length) {
        for (const food of results.foods) {
            console.log(`\n[${food.fdcId}] ${food.description} (${food.dataType})`);
            computeFdcScore(query, food.description, food.dataType || '');
        }
    }
}

debugFdcScoring().catch(console.error);
