
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';

async function main() {
    console.log('--- Investigating Root Cause for "Strawberry (Tony\'s)" ---');

    const rawLine = "2 cup stberry halves";
    const normalized = "strawberry halves";

    console.log(`Querying for: "${normalized}"`);

    // 1. Gather (Force skip cache to get fresh candidates)
    // gatherCandidates(rawLine, parsed, normalizedName, options)
    const candidates = await gatherCandidates(rawLine, null, normalized, {
        skipCache: true,
        skipFdc: false,
        skipLiveApi: false
    });

    console.log(`\nGathered ${candidates.length} candidates.`);

    const tonys = candidates.find(c => c.id === '35976' || c.name.includes("TONY'S"));
    if (tonys) {
        console.log('VICTIM FOUND (Tony\'s):');
        console.log(JSON.stringify(tonys, null, 2));
        if (tonys.rawData && (tonys.rawData as any).nutrientsPer100g) {
            console.log('Macros per 100g:', (tonys.rawData as any).nutrientsPer100g);
        }
    } else {
        console.log('Tony\'s candidate NOT found in fresh search.');
    }

    // 2. Filter
    console.log('\n--- Running Filter ---');
    // filterCandidatesByTokens(candidates, rawLine, options)
    // Returns { filtered, removedCount }
    const filterResult = await filterCandidatesByTokens(candidates, rawLine, { debug: true, rawLine });
    const filtered = filterResult.filtered;

    const tonysSurvives = filtered.find(c => c.id === '35976');

    if (tonysSurvives) {
        console.log('❌ Tony\'s SURVIVED filtering!');
    } else {
        console.log('✅ Tony\'s was filtered out (by existing logic).');
    }

    // 3. Rerank
    if (filtered.length > 0) {
        const rerankInput = filtered.map(toRerankCandidate);
        const winner = simpleRerank(normalized, rerankInput);
        console.log(`\nWinner: ${winner?.winner.name} (Score: ${winner?.score})`);

        const tonysRanked = rerankInput.find(c => c.id === '35976');
        if (tonysRanked) {
            console.log(`Tony's Score: ${tonysRanked.score}`);
            console.log(`Tony's Penalties/Bonuses:`, tonysRanked.log);
        }
    }

}

main().catch(console.error).finally(() => prisma.$disconnect());
