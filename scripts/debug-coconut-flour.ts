// Debug script for coconut flour mapping
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { searchFatSecretCacheFoods } from '../src/lib/fatsecret/cache-search';

async function debug() {
    const input = 'coconut flour';

    console.log('='.repeat(60));
    console.log('DEBUGGING: coconut flour mapping');
    console.log('='.repeat(60));

    // Step 1: Parse
    const parsed = parseIngredientLine(`0.5 cup ${input}`);
    console.log('\n1. PARSED:', parsed);

    // Step 2: Normalize
    const normalized = normalizeIngredientName(parsed?.name || input);
    console.log('\n2. NORMALIZED:', normalized);

    // Step 3: Must-have tokens
    const tokens = normalized.cleaned
        .toLowerCase()
        .split(/[^\w]+/)
        .filter((t: string) => t.length > 2);
    console.log('\n3. TOKENS:', tokens);

    // Step 4: Specialty pattern check
    const specialtyPatterns = [
        /coconut\s+(flour|oil|milk|cream|sugar)/,
        /almond\s+(flour|milk|butter)/,
    ];
    const isSpecialty = specialtyPatterns.some(p => p.test(normalized.cleaned.toLowerCase()));
    console.log('\n4. IS SPECIALTY:', isSpecialty);
    console.log('   If specialty, only require first token:', isSpecialty ? tokens.slice(0, 1) : tokens);

    // Step 5: Search cache
    console.log('\n5. SEARCHING CACHE for "coconut flour"...');
    const cacheResults = await searchFatSecretCacheFoods('coconut flour', 10);
    console.log(`   Found ${cacheResults.length} results:`);
    for (const r of cacheResults.slice(0, 5)) {
        console.log(`   - ${r.name} (${r.brandName || 'Generic'})`);
    }

    // Step 6: Check if any results contain "coconut"
    console.log('\n6. CHECKING which results contain "coconut":');
    for (const r of cacheResults.slice(0, 5)) {
        const nameLC = (r.name || '').toLowerCase();
        const brandLC = (r.brandName || '').toLowerCase();
        const hasCoconut = nameLC.includes('coconut') || brandLC.includes('coconut');
        console.log(`   - ${r.name}: ${hasCoconut ? '✅ HAS coconut' : '❌ NO coconut'}`);
    }

    await prisma.$disconnect();
}

debug().catch(console.error);
