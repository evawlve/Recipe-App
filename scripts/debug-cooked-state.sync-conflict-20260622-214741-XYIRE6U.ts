import 'dotenv/config';
import { prisma } from '@/lib/db';
import { normalizeQuery, tokens } from '@/lib/search/normalize';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { rankCandidates, Candidate } from '@/lib/foods/rank';
import { batchFetchAliases } from '@/lib/foods/alias-cache';

// Test cases from gold.cooked-state.csv that are failing
const testCases = [
  { id: '26', query: '1 cup salmon, cooked', expected: 'salmon, Atlantic, farmed, cooked, dry heat' },
  { id: '13', query: '1 cup brown rice, cooked', expected: 'rice, brown, long-grain, cooked' },
  { id: '41', query: '1 cup pasta, cooked', expected: 'pasta, cooked, enriched, without added salt' },
  { id: '27', query: '1 cup ground beef, cooked', expected: 'beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled' },
];

async function debugCase(testCase: typeof testCases[0]) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing: ${testCase.query}`);
  console.log(`Expected: ${testCase.expected}`);
  console.log(`${'='.repeat(80)}\n`);

  const parsed = parseIngredientLine(testCase.query);
  const searchQuery = parsed ? parsed.name : testCase.query;
  const normalized = normalizeQuery(searchQuery);
  const ts = tokens(normalized);
  
  console.log(`Parsed query: "${searchQuery}"`);
  console.log(`Qualifiers: ${parsed?.qualifiers?.join(', ') || 'none'}`);
  console.log(`Tokens: ${ts.join(', ')}\n`);

  if (ts.length === 0) {
    console.log('No tokens found!');
    return;
  }

  const andORs = ts.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
      { aliases: { some: { alias: { contains: t, mode: 'insensitive' as const } } } },
    ]
  }));

  const foods = await prisma.food.findMany({
    where: { AND: andORs },
    take: 50, // Match eval/run.ts
    orderBy: [
      { verification: 'asc' },
      { popularity: 'desc' },
    ],
    select: {
      id: true,
      name: true,
      brand: true,
      source: true,
      verification: true,
      categoryId: true,
      kcal100: true,
      protein100: true,
      carbs100: true,
      fat100: true,
      densityGml: true,
      popularity: true,
      units: { select: { label: true, grams: true } },
    }
  });

  if (foods.length === 0) {
    console.log('No foods found!');
    return;
  }

  console.log(`Found ${foods.length} candidate foods\n`);

  const foodIds = foods.map(f => f.id);
  const aliasMap = await batchFetchAliases(foodIds);

  const candidates: Candidate[] = foods.map(food => ({
    food: {
      id: food.id,
      name: food.name,
      brand: food.brand,
      source: food.source,
      verification: food.verification as 'verified' | 'unverified' | 'suspect',
      kcal100: food.kcal100,
      protein100: food.protein100,
      carbs100: food.carbs100,
      fat100: food.fat100,
      densityGml: food.densityGml,
      categoryId: food.categoryId,
      popularity: food.popularity || 0
    },
    aliases: aliasMap.get(food.id) || [],
    barcodes: [],
    usedByUserCount: 0
  }));

  const ranked = rankCandidates(candidates, {
    query: searchQuery,
    unitHint: parsed?.unitHint ?? null,
    qualifiers: parsed?.qualifiers
  });

  // Check if expected food is in the ranked list
  const expectedInList = ranked.find(r => {
    const foodName = r.candidate.food.name.toLowerCase();
    return foodName.includes(testCase.expected.toLowerCase()) || 
           testCase.expected.toLowerCase().includes(foodName);
  });
  
  if (expectedInList) {
    const index = ranked.indexOf(expectedInList);
    console.log(`✅ Expected food found at rank ${index + 1}:\n`);
    const r = expectedInList;
    const food = r.candidate.food;
    console.log(`   ${food.name}${food.brand ? ` (${food.brand})` : ''}`);
    console.log(`   Score: ${r.score.toFixed(2)}, Confidence: ${r.confidence.toFixed(2)}`);
    console.log(`   Source: ${food.source}, Verification: ${food.verification}\n`);
  } else {
    console.log(`❌ Expected food NOT FOUND in ranked list!\n`);
    // Check if it's in the database results but not ranked
    const inDbResults = foods.find(f => {
      const foodName = f.name.toLowerCase();
      const expectedLower = testCase.expected.toLowerCase();
      // More specific matching - check for key words
      const keyWords = expectedLower.split(/[,\s]+/).filter(w => w.length > 3);
      return keyWords.every(kw => foodName.includes(kw)) || 
             foodName.includes(expectedLower) || 
             expectedLower.includes(foodName);
    });
    if (inDbResults) {
      const rank = ranked.findIndex(r => r.candidate.food.id === inDbResults.id);
      console.log(`   ⚠️  But it IS in database results: ${inDbResults.name}`);
      if (rank >= 0) {
        console.log(`   Ranked at position ${rank + 1} with score ${ranked[rank].score.toFixed(2)}`);
      } else {
        console.log(`   But NOT in ranked list (filtered out?)`);
      }
      console.log('');
    } else {
      console.log(`   ⚠️  NOT in database results either (not in top 50 candidates).`);
      console.log(`   Searched ${foods.length} foods. Looking for: "${testCase.expected}"\n`);
    }
  }

  console.log('Top 5 ranked candidates:\n');
  ranked.slice(0, 5).forEach((r, i) => {
    const food = r.candidate.food;
    const aliases = r.candidate.aliases || [];
    const isExpected = food.name.toLowerCase().includes(testCase.expected.toLowerCase()) ||
                       testCase.expected.toLowerCase().includes(food.name.toLowerCase());
    
    console.log(`${i + 1}. ${isExpected ? '✅' : '❌'} ${food.name}${food.brand ? ` (${food.brand})` : ''}`);
    console.log(`   Score: ${r.score.toFixed(2)}, Confidence: ${r.confidence.toFixed(2)}`);
    console.log(`   Source: ${food.source}, Verification: ${food.verification}`);
    console.log(`   Aliases: ${aliases.slice(0, 3).join(', ')}${aliases.length > 3 ? '...' : ''}`);
    
    // Check for cooked/raw state
    const foodText = `${food.name} ${aliases.join(' ')}`.toLowerCase();
    const hasCooked = /cooked|baked|roasted|grilled|fried|boiled|steamed/.test(foodText);
    const hasRaw = /raw|fresh|uncooked/.test(foodText);
    const queryHasCooked = /cooked|baked|roasted|grilled|fried|boiled|steamed/.test(searchQuery.toLowerCase());
    
    if (queryHasCooked && hasRaw) {
      console.log(`   ⚠️  STATE MISMATCH: Query wants cooked, but food is raw!`);
    } else if (queryHasCooked && hasCooked) {
      console.log(`   ✅ State match: cooked`);
    } else if (queryHasCooked && !hasCooked && !hasRaw) {
      console.log(`   ⚠️  Query wants cooked, but food state is unclear`);
    }
    console.log('');
  });
}

async function main() {
  for (const testCase of testCases) {
    await debugCase(testCase);
  }
  await prisma.$disconnect();
}

main().catch(console.error);

