#!/usr/bin/env ts-node

import 'dotenv/config';
import { searchFoods } from '../src/lib/usda';

/**
 * Debug why "1 cup salt" is finding tuna instead of Salt, Table
 */

async function main() {
  console.log('🔍 Debugging "salt" search\n');
  console.log('=' .repeat(80));
  
  const results = await searchFoods('salt', { limit: 10 });
  
  console.log(`\nFound ${results.length} results for "salt":\n`);
  
  for (let i = 0; i < results.length; i++) {
    const food = results[i];
    console.log(`\n${i + 1}. ${food.name}`);
    console.log(`   ID: ${food.id}`);
    console.log(`   Category: ${food.categoryId}`);
    console.log(`   Source: ${food.source}`);
    console.log(`   Verification: ${food.verification}`);
  }
  
  // Also search with multiple keywords
  console.log('\n\n' + '='.repeat(80));
  console.log('\n🔍 Searching for "salt" AND "table":\n');
  
  const results2 = await searchFoods('salt table', { limit: 10 });
  
  console.log(`\nFound ${results2.length} results:\n`);
  
  for (let i = 0; i < results2.length; i++) {
    const food = results2[i];
    console.log(`\n${i + 1}. ${food.name}`);
    console.log(`   ID: ${food.id}`);
    console.log(`   Category: ${food.categoryId}`);
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));

