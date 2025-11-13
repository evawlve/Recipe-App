#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase A: Debug portion calculation issues
 * Investigate egg and chicken breast FoodUnit entries
 */

async function main() {
  console.log('🔍 Phase A: Debugging Portion Issues\n');
  console.log('=' .repeat(80));
  
  // 1. Check egg portions
  console.log('\n📊 Investigating: Eggs\n');
  
  const eggs = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'egg', mode: 'insensitive' } },
        { name: { contains: 'Eggs', mode: 'insensitive' } }
      ]
    },
    include: {
      units: true
    },
    take: 10
  });
  
  console.log(`Found ${eggs.length} egg foods:\n`);
  
  for (const egg of eggs) {
    console.log(`\n📝 ${egg.name}`);
    console.log(`   ID: ${egg.id}`);
    console.log(`   Source: ${egg.source}`);
    console.log(`   Units: ${egg.units.length}`);
    
    if (egg.units.length > 0) {
      for (const unit of egg.units) {
        console.log(`     - ${unit.label}: ${unit.grams}g`);
      }
    } else {
      console.log(`     ⚠️  No FoodUnit entries`);
    }
    
    // Check if this matches our expected food
    if (egg.name.toLowerCase().includes('grade a') && egg.name.toLowerCase().includes('large')) {
      console.log(`   ⭐ THIS IS THE ONE! (matches "Eggs, Grade A, Large, egg whole")`);
    }
  }
  
  // 2. Check chicken breast portions
  console.log('\n\n📊 Investigating: Chicken Breasts\n');
  
  const chickens = await prisma.food.findMany({
    where: {
      name: { contains: 'chicken breast', mode: 'insensitive' }
    },
    include: {
      units: true
    },
    take: 10
  });
  
  console.log(`Found ${chickens.length} chicken breast foods:\n`);
  
  for (const chicken of chickens) {
    console.log(`\n📝 ${chicken.name}`);
    console.log(`   ID: ${chicken.id}`);
    console.log(`   Source: ${chicken.source}`);
    console.log(`   Units: ${chicken.units.length}`);
    
    if (chicken.units.length > 0) {
      for (const unit of chicken.units) {
        console.log(`     - ${unit.label}: ${unit.grams}g`);
      }
    } else {
      console.log(`     ⚠️  No FoodUnit entries`);
    }
  }
  
  // 3. Summary & Recommendations
  console.log('\n\n' + '='.repeat(80));
  console.log('📋 RECOMMENDATIONS:\n');
  
  console.log('Expected Weights:');
  console.log('  - 1 large egg: ~50g (current standard)');
  console.log('  - 1 large chicken breast: ~140g (boneless, skinless)');
  console.log('  - 1 chicken drumstick: ~100g');
  console.log('  - 1 chicken thigh: ~70-80g');
  
  console.log('\nIf any weights are incorrect, update them using the fix script.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

