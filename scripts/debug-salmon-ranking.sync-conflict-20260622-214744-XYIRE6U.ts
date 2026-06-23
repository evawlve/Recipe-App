import 'dotenv/config';
import { prisma } from '@/lib/db';
import { normalizeQuery, tokens } from '@/lib/search/normalize';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { rankCandidates, Candidate } from '@/lib/foods/rank';
import { batchFetchAliases } from '@/lib/foods/alias-cache';

async function debugSalmon() {
  const query = '1 cup salmon, cooked';
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

  console.log(`Found ${foods.length} candidates\n`);

  // Find the cooked Atlantic salmon (prefer farmed, fallback to wild)
  const cookedSalmonFarmed = foods.find(f => 
    f.name.toLowerCase().includes('atlantic') && 
    f.name.toLowerCase().includes('farmed') &&
    f.name.toLowerCase().includes('cooked') &&
    f.name.toLowerCase().includes('salmon')
  );
  const cookedSalmonWild = foods.find(f => 
    f.name.toLowerCase().includes('atlantic') && 
    f.name.toLowerCase().includes('wild') &&
    f.name.toLowerCase().includes('cooked') &&
    f.name.toLowerCase().includes('salmon')
  );
  const cookedSalmon = cookedSalmonFarmed || cookedSalmonWild;

  if (cookedSalmon) {
    const type = cookedSalmonFarmed ? 'FARMED' : 'WILD';
    console.log(`✅ Found cooked Atlantic salmon (${type}): ${cookedSalmon.name}`);
    console.log(`   Source: ${cookedSalmon.source}, Verification: ${cookedSalmon.verification}, Popularity: ${cookedSalmon.popularity}\n`);
  } else {
    console.log(`❌ Cooked Atlantic salmon NOT in top 50 candidates!\n`);
    // Check if it exists at all
    const allSalmon = await prisma.food.findMany({
      where: {
        name: { contains: 'salmon', mode: 'insensitive' },
        AND: [
          { name: { contains: 'Atlantic', mode: 'insensitive' } },
          { name: { contains: 'cooked', mode: 'insensitive' } },
        ]
      },
      take: 5,
      select: { name: true, popularity: true, verification: true }
    });
    if (allSalmon.length > 0) {
      console.log(`But it exists in database:`);
      allSalmon.forEach(f => {
        console.log(`   - ${f.name} (pop: ${f.popularity}, ver: ${f.verification})`);
      });
    }
    await prisma.$disconnect();
    return;
  }

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

  const cookedSalmonRank = ranked.findIndex(r => r.candidate.food.id === cookedSalmon.id);
  const templateSalmon = ranked.find(r => r.candidate.food.name === 'Salmon' && r.candidate.food.source === 'template');

  console.log(`\nRanking Results:\n`);
  if (cookedSalmonRank >= 0) {
    const r = ranked[cookedSalmonRank];
    console.log(`✅ Cooked salmon ranked at position ${cookedSalmonRank + 1}`);
    console.log(`   Score: ${r.score.toFixed(2)}, Confidence: ${r.confidence.toFixed(2)}`);
  } else {
    console.log(`❌ Cooked salmon NOT in ranked list!`);
  }

  if (templateSalmon) {
    const templateRank = ranked.indexOf(templateSalmon);
    console.log(`\n❌ Template "Salmon" ranked at position ${templateRank + 1}`);
    console.log(`   Score: ${templateSalmon.score.toFixed(2)}, Confidence: ${templateSalmon.confidence.toFixed(2)}`);
    console.log(`   This is ${templateSalmon.score - (cookedSalmonRank >= 0 ? ranked[cookedSalmonRank].score : 0)} points higher than cooked salmon`);
  }

  console.log(`\nTop 3 candidates:`);
  ranked.slice(0, 3).forEach((r, i) => {
    const f = r.candidate.food;
    const isCooked = f.name.toLowerCase().includes('cooked');
    const isTemplate = f.source === 'template';
    console.log(`\n${i + 1}. ${isCooked ? '✅' : '❌'} ${f.name}${f.brand ? ` (${f.brand})` : ''}`);
    console.log(`   Score: ${r.score.toFixed(2)}, Source: ${f.source}, Ver: ${f.verification}`);
    if (isTemplate) console.log(`   ⚠️  Template food (should be penalized for missing cooked state)`);
    if (isCooked) console.log(`   ✅ Has cooked state`);
  });

  await prisma.$disconnect();
}

debugSalmon().catch(console.error);

