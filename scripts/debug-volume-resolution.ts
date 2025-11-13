#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { deriveServingOptions } from '../src/lib/units/servings';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { resolveGramsFromParsed } from '../src/lib/nutrition/resolve-grams';

/**
 * Debug why "1 cup cottage cheese" resolves to 56.4g instead of 226g
 */

async function main() {
  console.log('🔍 Debugging Volume Portion Resolution\n');
  console.log('='.repeat(80));
  
  // Find cottage cheese
  const cottageCheese = await prisma.food.findFirst({
    where: {
      OR: [
        { name: { contains: 'cottage', mode: 'insensitive' } },
        { name: { contains: 'Cottage', mode: 'insensitive' } }
      ]
    },
    include: {
      units: true
    }
  });
  
  if (!cottageCheese) {
    console.log('❌ Cottage cheese not found!');
    console.log('Searching for any cheese...');
    const cheeses = await prisma.food.findMany({
      where: { name: { contains: 'cheese', mode: 'insensitive' } },
      take: 5
    });
    console.log('Found:', cheeses.map(f => f.name));
    await prisma.$disconnect();
    return;
  }
  
  console.log(`\n📝 Food: ${cottageCheese.name}`);
  console.log(`   ID: ${cottageCheese.id}`);
  console.log(`   densityGml: ${cottageCheese.densityGml}`);
  console.log(`   Category: ${cottageCheese.categoryId}`);
  
  console.log(`\n📦 FoodUnits (${cottageCheese.units.length}):`);
  for (const unit of cottageCheese.units) {
    console.log(`   - "${unit.label}": ${unit.grams}g`);
  }
  
  // Generate serving options
  const servingOptions = deriveServingOptions({
    units: cottageCheese.units.map(u => ({ label: u.label, grams: u.grams })),
    densityGml: cottageCheese.densityGml ?? undefined,
    categoryId: cottageCheese.categoryId ?? null
  });
  
  console.log(`\n📋 Derived Serving Options (${servingOptions.length}):`);
  for (const opt of servingOptions.slice(0, 10)) {
    console.log(`   - "${opt.label}": ${opt.grams.toFixed(1)}g`);
  }
  
  // Parse "1 cup cottage cheese"
  const parsed = parseIngredientLine('1 cup cottage cheese');
  console.log(`\n🔍 Parsed: "${parsed?.raw_line || 'null'}"`);
  if (parsed) {
    console.log(`   qty: ${parsed.qty}`);
    console.log(`   multiplier: ${parsed.multiplier}`);
    console.log(`   unit: ${parsed.unit}`);
    console.log(`   name: ${parsed.name}`);
  }
  
  // Resolve grams
  if (parsed) {
    const grams = resolveGramsFromParsed(parsed, servingOptions);
    console.log(`\n⚖️  Resolved: ${grams}g`);
    console.log(`   Expected: 226g`);
    console.log(`   Difference: ${grams ? (226 - grams).toFixed(1) : 'N/A'}g`);
    
      // Debug: which option was matched?
      if (parsed.unit && grams) {
        const unitLower = parsed.unit.toLowerCase();
        console.log(`\n🔎 Which option was used?`);
        
        // Find which option gives us the resolved grams
        const qtyEff = parsed.qty * parsed.multiplier;
        const gramsPerUnit = grams / qtyEff;
        
        const matchedOption = servingOptions.find(opt => 
          Math.abs(opt.grams - gramsPerUnit) < 0.1
        );
        
        if (matchedOption) {
          console.log(`   ✅ Matched: "${matchedOption.label}" = ${matchedOption.grams}g per unit`);
          console.log(`   Calculation: ${qtyEff} × ${matchedOption.grams}g = ${grams}g`);
        } else {
          console.log(`   ⚠️  Could not identify exact match (grams per unit: ${gramsPerUnit.toFixed(1)}g)`);
        }
      }
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);

