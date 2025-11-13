#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase A: Fix portion calculation issues
 * Add missing piece units for eggs and chicken breasts
 */

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase A: Fixing Portion Issues\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  let added = 0;
  let updated = 0;
  
  // Fix 1: Add "1 egg" unit to Eggs, Grade A, Large, egg whole
  console.log('\n📝 Fix 1: Eggs, Grade A, Large, egg whole\n');
  
  const eggFood = await prisma.food.findFirst({
    where: {
      name: { equals: 'Eggs, Grade A, Large, egg whole', mode: 'insensitive' }
    },
    include: { units: true }
  });
  
  if (!eggFood) {
    console.log('   ❌ Food not found: Eggs, Grade A, Large, egg whole');
  } else {
    console.log(`   ✅ Found: ${eggFood.name} (${eggFood.id})`);
    console.log(`   Current units: ${eggFood.units.length}`);
    
    // Check if "egg" unit already exists
    const hasEggUnit = eggFood.units.some(u => 
      u.label.toLowerCase().includes('egg') && 
      !u.label.toLowerCase().includes('cup')
    );
    
    if (hasEggUnit) {
      console.log('   ⏭️  Already has egg piece unit');
    } else {
      console.log('   📊 Adding: "1 large egg" → 50g');
      
      if (!dryRun) {
        await prisma.foodUnit.create({
          data: {
            foodId: eggFood.id,
            label: '1 large egg',
            grams: 50
          }
        });
        
        // Also add generic "egg" and "piece" for better matching
        await prisma.foodUnit.create({
          data: {
            foodId: eggFood.id,
            label: 'egg',
            grams: 50
          }
        });
        
        await prisma.foodUnit.create({
          data: {
            foodId: eggFood.id,
            label: 'piece',
            grams: 50
          }
        });
        
        added += 3;
        console.log('   ✅ Added 3 units: "1 large egg", "egg", "piece"');
      } else {
        console.log('   🔍 Would add 3 units (dry run)');
      }
    }
  }
  
  // Fix 2: Add "1 breast" unit to all chicken breast foods
  console.log('\n\n📝 Fix 2: Chicken Breast Foods\n');
  
  const chickenBreasts = await prisma.food.findMany({
    where: {
      name: { contains: 'chicken breast', mode: 'insensitive' }
    },
    include: { units: true }
  });
  
  console.log(`   Found ${chickenBreasts.length} chicken breast foods\n`);
  
  for (const chicken of chickenBreasts) {
    console.log(`   📝 ${chicken.name} (${chicken.id})`);
    
    // Check if "breast" unit already exists
    const hasBreastUnit = chicken.units.some(u => 
      u.label.toLowerCase().includes('breast') && 
      !u.label.toLowerCase().includes('cup')
    );
    
    if (hasBreastUnit) {
      console.log('      ⏭️  Already has breast piece unit');
    } else {
      console.log('      📊 Adding: "1 breast" → 140g, "piece" → 140g');
      
      if (!dryRun) {
        await prisma.foodUnit.create({
          data: {
            foodId: chicken.id,
            label: '1 breast',
            grams: 140
          }
        });
        
        await prisma.foodUnit.create({
          data: {
            foodId: chicken.id,
            label: 'breast',
            grams: 140
          }
        });
        
        await prisma.foodUnit.create({
          data: {
            foodId: chicken.id,
            label: 'piece',
            grams: 140
          }
        });
        
        added += 3;
        console.log('      ✅ Added 3 units');
      } else {
        console.log('      🔍 Would add 3 units (dry run)');
      }
    }
  }
  
  // Fix 3: Verify Chicken Breast template (seed_chicken_breast)
  console.log('\n\n📝 Fix 3: Verify Chicken Breast Template\n');
  
  const templateChicken = await prisma.food.findUnique({
    where: { id: 'seed_chicken_breast' },
    include: { units: true }
  });
  
  if (templateChicken) {
    console.log(`   ✅ Found: ${templateChicken.name}`);
    console.log(`   Current units:`);
    for (const unit of templateChicken.units) {
      console.log(`     - ${unit.label}: ${unit.grams}g`);
    }
    
    const hasBreastUnit = templateChicken.units.some(u => 
      u.label.toLowerCase().includes('breast')
    );
    
    if (!hasBreastUnit) {
      console.log('   📊 Adding breast piece units');
      
      if (!dryRun) {
        await prisma.foodUnit.createMany({
          data: [
            { foodId: templateChicken.id, label: '1 breast', grams: 140 },
            { foodId: templateChicken.id, label: 'breast', grams: 140 },
            { foodId: templateChicken.id, label: 'piece', grams: 140 }
          ]
        });
        added += 3;
        console.log('   ✅ Added 3 units');
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   ✅ Units added: ${added}`);
  console.log(`   🔄 Units updated: ${updated}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Fixes applied!');
    console.log('\n🧪 Next Steps:');
    console.log('   1. Run: npm run eval');
    console.log('   2. Check if "2 large eggs" now resolves to 100g');
    console.log('   3. Check if "2 large chicken breasts" now resolves to 280g');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

