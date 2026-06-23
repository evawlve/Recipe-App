import 'dotenv/config';
import { prisma } from '@/lib/db';
import { normalizeQuery, tokens } from '@/lib/search/normalize';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { rankCandidates, Candidate } from '@/lib/foods/rank';
import { batchFetchAliases } from '@/lib/foods/alias-cache';

async function debugBrownRice() {
  const query = '1 cup brown rice, cooked';
  const parsed = parseIngredientLine(query);
  const searchQuery = parsed ? parsed.name : query;
  
  console.log(`Query: "${query}"`);
  console.log(`Parsed: "${searchQuery}"`);
  console.log(`Qualifiers: ${parsed?.qualifiers?.join(', ') || 'none'}\n`);

  const normalized = normalizeQuery(searchQuery);
  const ts = tokens(normalized);
  const andORs = ts.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
      { aliases: { some: { alias: { contains: t, mode: 'insensitive' as const } } } },
    ]
  }));

  const foods = await prisma.food.findMany({
    where: { AND: andORs },
    take: 50,
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

  // Check if "Rice noodles" has "brown" in aliases
  const noodlesCandidate = candidates.find(c => c.food.name.toLowerCase().includes('noodles'));
  if (noodlesCandidate) {
    console.log(`\nChecking "Rice noodles":`);
    console.log(`   Name: ${noodlesCandidate.food.name}`);
    console.log(`   Aliases: ${(noodlesCandidate.aliases || []).join(', ')}`);
    const allText = `${noodlesCandidate.food.name} ${(noodlesCandidate.aliases || []).join(' ')}`.toLowerCase();
    console.log(`   Contains "brown": ${allText.includes('brown')}`);
  }

  const expected = ranked.find(r => 
    r.candidate.food.name.toLowerCase().includes('brown') &&
    r.candidate.food.name.toLowerCase().includes('long-grain') &&
    r.candidate.food.name.toLowerCase().includes('cooked')
  );

  const noodlesRanked = ranked.find(r => 
    r.candidate.food.name.toLowerCase().includes('noodles')
  );

  // Check if "Pork sausage rice links" is in the list
  const porkSausage = ranked.find(r => r.candidate.food.name.toLowerCase().includes('pork sausage'));
  if (porkSausage) {
    const rank = ranked.indexOf(porkSausage);
    console.log(`\n⚠️  "Pork sausage rice links" at rank ${rank + 1} with score ${porkSausage.score.toFixed(2)}`);
    console.log(`   Has "brown" in name: ${porkSausage.candidate.food.name.toLowerCase().includes('brown')}`);
    console.log(`   Has "rice" in name: ${porkSausage.candidate.food.name.toLowerCase().includes('rice')}`);
  }

  console.log(`\nTop 5 ranked:\n`);
  ranked.slice(0, 5).forEach((r, i) => {
    const f = r.candidate.food;
    const isExpected = f.id === expected?.candidate.food.id;
    const isNoodles = f.id === noodlesRanked?.candidate.food.id;
    console.log(`${i + 1}. ${isExpected ? '✅ EXPECTED' : isNoodles ? '❌ NOODLES' : ''} ${f.name}`);
    console.log(`   Score: ${r.score.toFixed(2)}, Source: ${f.source}`);
  });

  if (expected) {
    const rank = ranked.indexOf(expected);
    console.log(`\n✅ Expected food at rank ${rank + 1} with score ${expected.score.toFixed(2)}`);
  } else {
    console.log(`\n❌ Expected food not found in ranked list`);
  }

  await prisma.$disconnect();
}

debugBrownRice().catch(console.error);

