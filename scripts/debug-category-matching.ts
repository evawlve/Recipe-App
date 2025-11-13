#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Debug why category incompatibility isn't working
 * Check category IDs for problematic foods
 */

async function main() {
  console.log('🔍 Debugging Category Matching Issues\n');
  console.log('=' .repeat(80));
  
  // Check the foods that are incorrectly matching
  const problematicFoods = [
    'Fish, tuna, light, canned in oil, without salt, drained solids', // Matching "salt"
    'Candies, milk chocolate coated peanuts', // Matching "oat milk"
    'Beef, brisket, flat half, separable lean and fat, trimmed to 1/8" fat, all grades, raw', // Matching "half and half"
    'Tomato products, canned, sauce', // Matching "tomato, diced"
  ];
  
  console.log('\n📊 Checking Category IDs:\n');
  
  for (const foodName of problematicFoods) {
    const food = await prisma.food.findFirst({
      where: {
        name: { contains: foodName, mode: 'insensitive' }
      },
      select: {
        name: true,
        categoryId: true,
        source: true
      }
    });
    
    if (food) {
      console.log(`\n📝 ${food.name.substring(0, 60)}...`);
      console.log(`   Category ID: ${food.categoryId}`);
      console.log(`   Source: ${food.source}`);
    } else {
      console.log(`\n❌ Not found: ${foodName}`);
    }
  }
  
  // Check what we expect
  console.log('\n\n📋 Expected Foods:\n');
  
  const expectedFoods = [
    'Salt, Table',
    'beverages, oat milk',
    'cream, fluid, half and half',
    'tomatoes, red, ripe, raw'
  ];
  
  for (const foodName of expectedFoods) {
    const food = await prisma.food.findFirst({
      where: {
        name: { contains: foodName, mode: 'insensitive' }
      },
      select: {
        name: true,
        categoryId: true,
        source: true
      }
    });
    
    if (food) {
      console.log(`\n✅ ${food.name}`);
      console.log(`   Category ID: ${food.categoryId}`);
      console.log(`   Source: ${food.source}`);
    } else {
      console.log(`\n❌ Not found: ${foodName}`);
    }
  }
  
  // List all unique category IDs
  console.log('\n\n📊 All Unique Category IDs in Database:\n');
  
  const categories = await prisma.food.groupBy({
    by: ['categoryId'],
    _count: { categoryId: true },
    orderBy: { _count: { categoryId: 'desc' } }
  });
  
  console.log(`Found ${categories.length} unique categories:\n`);
  for (const cat of categories.slice(0, 30)) {
    console.log(`   ${cat.categoryId || '(null)'}: ${cat._count.categoryId} foods`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

