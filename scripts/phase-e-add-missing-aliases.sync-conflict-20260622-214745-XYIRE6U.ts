#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase E Step 4: Add missing aliases and portions
 * - "½ block tofu" → Add "block" portion to tofu
 * - "broccoli florets" → Add "florets" alias to broccoli
 */

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase E Step 4: Adding Missing Aliases & Portions\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('='.repeat(80));
  
  let aliasesAdded = 0;
  let unitsAdded = 0;
  
  // 1. Add "block" portion to Tofu, Firm
  console.log('\n📝 Fix 1: Tofu, Firm - Add "block" portion\n');
  
  const tofu = await prisma.food.findFirst({
    where: {
      OR: [
        { name: { contains: 'Tofu, Firm', mode: 'insensitive' } },
        { name: { contains: 'Tofu', mode: 'insensitive' } }
      ]
    },
    include: {
      units: true,
      aliases: true
    }
  });
  
  if (!tofu) {
    console.log('   ❌ Tofu not found!');
  } else {
    console.log(`   ✅ Found: ${tofu.name}`);
    console.log(`   Current units: ${tofu.units.length}`);
    console.log(`   Current aliases: ${tofu.aliases.length}`);
    
    // Check if "block" unit exists
    const hasBlockUnit = tofu.units.some(u => 
      u.label.toLowerCase().includes('block')
    );
    
    if (!hasBlockUnit) {
      // Standard tofu block is ~350g (14 oz)
      const blockGrams = 350;
      console.log(`   ➕ Will add: "1 block" = ${blockGrams}g`);
      
      if (!dryRun) {
        await prisma.foodUnit.create({
          data: {
            foodId: tofu.id,
            label: '1 block',
            grams: blockGrams
          }
        });
        unitsAdded++;
      }
    } else {
      console.log('   ✅ "block" unit already exists');
    }
    
    // Also add "½ block" unit
    const hasHalfBlockUnit = tofu.units.some(u => 
      u.label.toLowerCase().includes('½ block') || 
      u.label.toLowerCase().includes('half block')
    );
    
    if (!hasHalfBlockUnit) {
      const halfBlockGrams = 175; // Half of 350g
      console.log(`   ➕ Will add: "½ block" = ${halfBlockGrams}g`);
      
      if (!dryRun) {
        await prisma.foodUnit.create({
          data: {
            foodId: tofu.id,
            label: '½ block',
            grams: halfBlockGrams
          }
        });
        unitsAdded++;
      }
    } else {
      console.log('   ✅ "½ block" unit already exists');
    }
  }
  
  // 2. Add "broccoli florets" alias to Broccoli
  console.log('\n📝 Fix 2: Broccoli - Add "florets" alias\n');
  
  const broccoli = await prisma.food.findFirst({
    where: {
      OR: [
        { name: { contains: 'Broccoli, Raw', mode: 'insensitive' } },
        { name: { contains: 'broccoli, raw', mode: 'insensitive' } },
        { name: { equals: 'Broccoli', mode: 'insensitive' } }
      ]
    },
    include: {
      aliases: true
    }
  });
  
  if (!broccoli) {
    console.log('   ❌ Broccoli not found!');
  } else {
    console.log(`   ✅ Found: ${broccoli.name}`);
    console.log(`   Current aliases: ${broccoli.aliases.length}`);
    
    // Check if "florets" alias exists
    const hasFloretsAlias = broccoli.aliases.some(a => 
      a.alias.toLowerCase().includes('floret')
    );
    
    if (!hasFloretsAlias) {
      console.log('   ➕ Will add: "broccoli florets" alias');
      
      if (!dryRun) {
        await prisma.foodAlias.create({
          data: {
            foodId: broccoli.id,
            alias: 'broccoli florets'
          }
        });
        aliasesAdded++;
      }
    } else {
      console.log('   ✅ "florets" alias already exists');
    }
    
    // Also add "florets" as standalone alias
    const hasFloretsStandalone = broccoli.aliases.some(a => 
      a.alias.toLowerCase() === 'florets'
    );
    
    if (!hasFloretsStandalone) {
      console.log('   ➕ Will add: "florets" alias');
      
      if (!dryRun) {
        await prisma.foodAlias.create({
          data: {
            foodId: broccoli.id,
            alias: 'florets'
          }
        });
        aliasesAdded++;
      }
    } else {
      console.log('   ✅ "florets" standalone alias already exists');
    }
  }
  
  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Summary:');
  console.log(`   Aliases added: ${aliasesAdded}`);
  console.log(`   Units added: ${unitsAdded}`);
  console.log(`   Total changes: ${aliasesAdded + unitsAdded}`);
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes made. Run without --dry-run to apply.');
  } else {
    console.log('\n✅ Changes applied successfully!');
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);

