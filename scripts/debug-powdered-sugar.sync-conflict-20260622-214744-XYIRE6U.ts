import 'dotenv/config';
import { gatherCandidates } from '../src/lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function debugPowderedSugar() {
    const rawLine = '2 tbsp powdered sugar';
    const parsed = parseIngredientLine(rawLine);
    const normalizedName = 'powdered sugar';

    console.log('\n🔍 Searching for:', normalizedName);
    console.log('Raw line:', rawLine);

    const candidates = await gatherCandidates(rawLine, parsed, normalizedName, {});

    console.log('\n📦 Found', candidates.length, 'candidates:');
    candidates.slice(0, 15).forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
    });

    // Also test the British term with synonym
    console.log('\n\n🔍 Testing British synonym expansion...');
    const britishRaw = '2 tbsp icing sugar';
    const britishParsed = parseIngredientLine(britishRaw);
    const britishNormalized = 'icing sugar';

    console.log('Raw line:', britishRaw);
    console.log('Normalized:', britishNormalized);

    const britishCandidates = await gatherCandidates(britishRaw, britishParsed, britishNormalized, {});

    console.log('\n📦 Found', britishCandidates.length, 'candidates:');
    britishCandidates.slice(0, 15).forEach((c, i) => {
        console.log(`  ${i + 1}. [${c.source}] ${c.name} (score: ${c.score.toFixed(3)})`);
    });

    process.exit(0);
}

debugPowderedSugar().catch(e => { console.error(e); process.exit(1); });
