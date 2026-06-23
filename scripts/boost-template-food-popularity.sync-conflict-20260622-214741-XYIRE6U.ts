#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Boost popularity for template foods so they rank higher
 * Template foods are curated and should appear first
 */

async function main() {
  console.log('📈 Boosting Template Food Popularity\n');
  console.log('=' .repeat(80));
  
  const POPULARITY_BOOST = 1000; // High value to ensure they rank first
  
  // Find all template foods with low popularity
  const templateFoods = await prisma.food.findMany({
    where: {
      source: 'template',
      popularity: { lt: POPULARITY_BOOST }
    }
  });
  
  console.log(`\nFound ${templateFoods.length} template foods with popularity < ${POPULARITY_BOOST}`);
  
  if (templateFoods.length === 0) {
    console.log('\n✅ All template foods already have high popularity!');
    return;
  }
  
  console.log('\nBoosting popularity:\n');
  
  for (const food of templateFoods) {
    const oldPop = food.popularity || 0;
    await prisma.food.update({
      where: { id: food.id },
      data: { popularity: POPULARITY_BOOST }
    });
    
    console.log(`  ✅ ${food.name}`);
    console.log(`     ${oldPop} → ${POPULARITY_BOOST}`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   Updated ${templateFoods.length} template foods`);
  console.log('\n💡 Template foods will now rank first in search results!');
  console.log('   Run: npm run eval');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

