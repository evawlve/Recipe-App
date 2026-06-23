#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Calculate missing densityGml from existing volume-based FoodUnits
 * If we have "1 cup = 240g", we can calculate densityGml = 240g / 240ml = 1.0 g/ml
 */

// Volume to ml conversions
const VOLUME_TO_ML: Record<string, number> = {
  'cup': 240,
  'cups': 240,
  'tbsp': 15,
  'tablespoon': 15,
  'tablespoons': 15,
  'tsp': 5,
  'teaspoon': 5,
  'teaspoons': 5,
  'ml': 1,
  'milliliter': 1,
  'milliliters': 1,
  'floz': 30,
  'fl oz': 30,
  'fluid ounce': 30,
  'fluid ounces': 30
};

function parseVolumeFromLabel(label: string): { volume: number; unit: string } | null {
  const labelLower = label.toLowerCase().trim();
  
  // Try to match volume units
  for (const [unit, ml] of Object.entries(VOLUME_TO_ML)) {
    if (labelLower.endsWith(unit)) {
      const beforeUnit = labelLower.slice(0, -unit.length).trim();
      
      // Parse quantity
      let qty = 1;
      if (!beforeUnit) {
        qty = 1;
      } else if (beforeUnit === '¼' || beforeUnit === '1/4') {
        qty = 0.25;
      } else if (beforeUnit === '½' || beforeUnit === '1/2') {
        qty = 0.5;
      } else if (beforeUnit === '¾' || beforeUnit === '3/4') {
        qty = 0.75;
      } else {
        const numMatch = beforeUnit.match(/^(\d+(?:\.\d+)?)$/);
        if (numMatch) {
          qty = parseFloat(numMatch[1]);
        } else {
          const fracMatch = beforeUnit.match(/^(\d+)\/(\d+)$/);
          if (fracMatch) {
            qty = parseFloat(fracMatch[1]) / parseFloat(fracMatch[2]);
          } else {
            continue; // Can't parse quantity
          }
        }
      }
      
      return { volume: qty * ml, unit };
    }
  }
  
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔍 Calculating Missing densityGml from FoodUnits\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('='.repeat(80));
  
  // Find all foods missing densityGml
  const foodsWithoutDensity = await prisma.food.findMany({
    where: {
      densityGml: null
    },
    include: {
      units: true
    }
  });
  
  console.log(`\n📊 Found ${foodsWithoutDensity.length} foods without densityGml\n`);
  
  let calculated = 0;
  let skipped = 0;
  const updates: Array<{ food: string; densityGml: number; source: string }> = [];
  
  for (const food of foodsWithoutDensity) {
    // Find volume-based FoodUnits
    const volumeUnits = food.units.filter(unit => {
      const parsed = parseVolumeFromLabel(unit.label);
      return parsed !== null;
    });
    
    if (volumeUnits.length === 0) {
      skipped++;
      continue;
    }
    
    // Use the first volume unit to calculate density
    // Prefer "1 cup" over fractional cups
    const preferredUnit = volumeUnits.find(u => {
      const label = u.label.toLowerCase();
      return label.includes('1 cup') || label.includes('1cup') || 
             (label.includes('cup') && !label.includes('¼') && !label.includes('½') && !label.includes('¾'));
    }) || volumeUnits[0];
    
    const parsed = parseVolumeFromLabel(preferredUnit.label);
    if (!parsed) continue;
    
    // Calculate density: grams / ml
    const densityGml = preferredUnit.grams / parsed.volume;
    
    // Sanity check: density should be reasonable (0.1 to 2.0 g/ml for most foods)
    if (densityGml < 0.1 || densityGml > 2.0) {
      console.log(`   ⚠️  Skipping ${food.name}: density ${densityGml.toFixed(3)} g/ml seems unreasonable`);
      skipped++;
      continue;
    }
    
    updates.push({
      food: food.name,
      densityGml,
      source: preferredUnit.label
    });
    
    console.log(`   ✅ ${food.name}`);
    console.log(`      Source: "${preferredUnit.label}" = ${preferredUnit.grams}g`);
    console.log(`      Volume: ${parsed.volume.toFixed(1)}ml`);
    console.log(`      Calculated densityGml: ${densityGml.toFixed(3)} g/ml`);
    
    if (!dryRun) {
      await prisma.food.update({
        where: { id: food.id },
        data: { densityGml }
      });
      calculated++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Summary:');
  console.log(`   Foods without densityGml: ${foodsWithoutDensity.length}`);
  console.log(`   Calculated from FoodUnits: ${updates.length}`);
  console.log(`   Skipped (no volume units or unreasonable): ${skipped}`);
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes made. Run without --dry-run to apply.');
  } else {
    console.log(`\n✅ Updated ${calculated} foods with calculated densityGml!`);
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);




