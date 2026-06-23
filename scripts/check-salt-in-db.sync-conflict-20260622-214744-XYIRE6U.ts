#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Check if Salt, Table exists in database with proper aliases
 */

async function main() {
  console.log('🔍 Checking if Salt, Table exists in database\n');
  console.log('=' .repeat(80));
  
  const salt = await prisma.food.findFirst({
    where: {
      OR: [
        { name: { contains: 'Salt, Table', mode: 'insensitive' } },
        { id: 'phase_d_salt' }
      ]
    },
    include: {
      aliases: true,
      units: true
    }
  });
  
  if (!salt) {
    console.log('\n❌ Salt, Table NOT FOUND in database!');
    return;
  }
  
  console.log('\n✅ Found Salt, Table:');
  console.log(`   ID: ${salt.id}`);
  console.log(`   Name: ${salt.name}`);
  console.log(`   Category: ${salt.categoryId}`);
  console.log(`   Source: ${salt.source}`);
  console.log(`   Verification: ${salt.verification}`);
  console.log(`\n   Nutrition:`);
  console.log(`     Kcal: ${salt.kcal100}`);
  console.log(`     Protein: ${salt.protein100}g`);
  console.log(`     Carbs: ${salt.carbs100}g`);
  console.log(`     Fat: ${salt.fat100}g`);
  console.log(`   DensityGml: ${salt.densityGml}`);
  
  console.log(`\n   Aliases (${salt.aliases.length}):`);
  for (const alias of salt.aliases) {
    console.log(`     - "${alias.alias}"`);
  }
  
  console.log(`\n   Units (${salt.units.length}):`);
  for (const unit of salt.units) {
    console.log(`     - ${unit.label}: ${unit.grams}g`);
  }
  
  // Now check if it shows up in a search
  console.log('\n\n' + '='.repeat(80));
  console.log('\n🔍 Searching database for "salt":\n');
  
  const foods = await prisma.food.findMany({
    where: {
      OR: [
        { name: { contains: 'salt', mode: 'insensitive' } },
        { brand: { contains: 'salt', mode: 'insensitive' } },
        { aliases: { some: { alias: { contains: 'salt', mode: 'insensitive' } } } }
      ]
    },
    take: 10,
    orderBy: [
      { verification: 'asc' },
      { popularity: 'desc' }
    ],
    select: {
      id: true,
      name: true,
      categoryId: true,
      source: true,
      verification: true
    }
  });
  
  console.log(`Found ${foods.length} foods:\n`);
  for (let i = 0; i < foods.length; i++) {
    const food = foods[i];
    console.log(`${i + 1}. ${food.name}`);
    console.log(`   ID: ${food.id}`);
    console.log(`   Category: ${food.categoryId}`);
    console.log(`   Source: ${food.source}`);
    console.log(`   Verification: ${food.verification}`);
    console.log();
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

