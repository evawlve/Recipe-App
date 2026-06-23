/**
 * Debug script to verify imported foods and search behavior
 */
import { prisma } from '../src/lib/db';
import { rankCandidates } from '../src/lib/foods/rank';

async function main() {
  console.log('🔍 PHASE 1: Verify Imported Foods in Database\n');
  console.log('=' .repeat(80));
  
  const targetQueries = [
    'ketchup',
    'catsup',
    'vinegar',
    'vinegar, distilled',
    'sriracha',
    'sriracha sauce',
    'chicken thigh',
    'chicken thighs',
    'baking powder',
    'baking soda',
    'vanilla extract',
  ];
  
  for (const query of targetQueries) {
    console.log(`\nSearching for: "${query}"`);
    const foods = await prisma.food.findMany({
      where: {
        name: {
          contains: query,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        brand: true,
        source: true,
        categoryId: true,
        verification: true,
      },
      take: 5,
    });
    
    if (foods.length === 0) {
      console.log('  ❌ NO FOODS FOUND');
    } else {
      console.log(`  ✅ Found ${foods.length} food(s):`);
      foods.forEach((f, idx) => {
        console.log(`     ${idx + 1}. [${f.source}] ${f.brand ? f.brand + ' ' : ''}${f.name}`);
        console.log(`        ID: ${f.id} | Category: ${f.categoryId || 'none'} | Verification: ${f.verification}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔍 PHASE 2: Check What Was Actually Imported\n');
  console.log('=' .repeat(80));
  
  // Check foods imported in the last 24 hours
  const recentFoods = await prisma.food.findMany({
    where: {
      createdAt: {
        gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
      }
    },
    select: {
      id: true,
      name: true,
      brand: true,
      source: true,
      categoryId: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: 50
  });
  
  if (recentFoods.length === 0) {
    console.log('\n  ❌ NO FOODS IMPORTED IN LAST 24 HOURS');
  } else {
    console.log(`\n  ✅ Found ${recentFoods.length} food(s) imported in last 24 hours:`);
    recentFoods.forEach((f, idx) => {
      console.log(`     ${idx + 1}. [${f.source}] ${f.name}`);
      console.log(`        ID: ${f.id} | Category: ${f.categoryId || 'none'}`);
    });
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔍 PHASE 3: Verify Food Aliases\n');
  console.log('=' .repeat(80));
  
  const aliasQueries = ['ketchup', 'catsup', 'chicken thigh', 'chicken thighs'];
  
  for (const query of aliasQueries) {
    console.log(`\nSearching for foods with alias: "${query}"`);
    const foodsWithAlias = await prisma.food.findMany({
      where: {
        aliases: {
          some: {
            alias: {
              contains: query,
              mode: 'insensitive',
            },
          },
        },
      },
      include: {
        aliases: true,
      },
      take: 5,
    });
    
    if (foodsWithAlias.length === 0) {
      console.log('  ❌ NO FOODS WITH THIS ALIAS');
    } else {
      console.log(`  ✅ Found ${foodsWithAlias.length} food(s):`);
      foodsWithAlias.forEach((f, idx) => {
        console.log(`     ${idx + 1}. ${f.name}`);
        console.log(`        Aliases: [${f.aliases.map(a => a.alias).join(', ')}]`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('🔍 PHASE 4: Test Search Token Matching\n');
  console.log('=' .repeat(80));
  
  const testQueries = [
    'ketchup',
    'vinegar',
    'sriracha',
    'chicken thighs',
    'baking powder',
  ];
  
  for (const query of testQueries) {
    console.log(`\nTesting search for: "${query}"`);
    
    // Simulate the search logic from route.ts
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    console.log(`  Tokens: [${tokens.join(', ')}]`);
    
    const andORs = tokens.map(t => ({
      OR: [
        { name: { contains: t, mode: 'insensitive' as const } },
        { brand: { contains: t, mode: 'insensitive' as const } },
      ],
    }));
    
    const foods = await prisma.food.findMany({
      where: {
        AND: andORs,
      },
      include: {
        aliases: true,
      },
      take: 10,
    });
    
    if (foods.length === 0) {
      console.log('  ❌ NO MATCHES IN DATABASE QUERY');
    } else {
      console.log(`  ✅ Found ${foods.length} candidate(s) from DB`);
      
      // Test ranking
      const candidates = foods.map(f => ({
        food: {
          id: f.id,
          name: f.name,
          brand: f.brand,
          source: f.source,
          verification: f.verification as any,
          kcal100: f.kcal100,
          protein100: f.protein100,
          carbs100: f.carbs100,
          fat100: f.fat100,
          densityGml: f.densityGml,
          categoryId: f.categoryId,
          popularity: f.popularity,
        },
        aliases: f.aliases.map(a => a.alias),
        barcodes: [],
        usedByUserCount: 0,
      }));
      
      const ranked = rankCandidates(candidates, { query });
      
      console.log('  Top 3 ranked results:');
      ranked.slice(0, 3).forEach((c, idx) => {
        console.log(`     ${idx + 1}. ${c.food.name} (score: ${c.score?.toFixed(3)})`);
        if (c.food.brand) console.log(`        Brand: ${c.food.brand}`);
      });
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('✅ Debug Complete\n');
  
  await prisma.$disconnect();
}

main().catch(console.error);

