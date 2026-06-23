#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import * as fs from 'fs';
import * as path from 'path';
import { normalizeUsdaRowToPer100g, fdcToUsdaRow } from '../src/ops/usda/normalize';
import { mapUsdaToCategory } from '../src/ops/usda/category-map';

/**
 * Sprint 7 Phase 2: Import Missing Nuts and Protein Powders from USDA
 * 
 * Target foods:
 * - Nuts: hazelnuts, pine nuts, macadamia nuts, brazil nuts, pistachios, cashews, pecans
 * - Tofu variations
 * - Protein powders (if available in USDA)
 */

interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients: Array<{
    nutrient: { name: string; number: string };
    amount: number;
  }>;
  foodCategory?: { description: string };
}

type FoodToImport = {
  searchTerm: string;
  aliases: string[];
  maxResults: number;
};

const FOODS_TO_IMPORT: FoodToImport[] = [
  // Nuts - search for raw/dried versions
  { searchTerm: 'hazelnuts', aliases: ['hazelnuts', 'filberts'], maxResults: 1 },
  { searchTerm: 'pine nuts', aliases: ['pine nuts'], maxResults: 1 },
  { searchTerm: 'macadamia nuts, raw', aliases: ['macadamia nuts', 'macadamias'], maxResults: 1 },
  { searchTerm: 'brazil nuts', aliases: ['brazil nuts', 'brazilnuts'], maxResults: 1 },
  { searchTerm: 'pistachio nuts', aliases: ['pistachios', 'pistachio nuts'], maxResults: 1 },
  { searchTerm: 'cashew nuts, raw', aliases: ['cashews', 'cashew nuts'], maxResults: 1 },
  { searchTerm: 'pecans', aliases: ['pecans', 'pecan nuts'], maxResults: 1 },
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🌰 Sprint 7 Phase 2: Import Missing Nuts from USDA\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('=' .repeat(80));
  
  // Load USDA data files
  const foundationPath = path.join(process.cwd(), 'data', 'usda', 'FoodData_Central_foundation_food_json_2025-04-24.json');
  const srLegacyPath = path.join(process.cwd(), 'data', 'usda', 'FoodData_Central_sr_legacy_food_json_2018-04.json');
  
  let foundationFoods: UsdaFood[] = [];
  let srLegacyFoods: UsdaFood[] = [];
  
  console.log('\n📂 Loading USDA data files...');
  
  if (fs.existsSync(foundationPath)) {
    const foundationData = JSON.parse(fs.readFileSync(foundationPath, 'utf-8'));
    foundationFoods = foundationData.FoundationFoods || [];
    console.log(`   ✅ Foundation Foods: ${foundationFoods.length} entries`);
  }
  
  if (fs.existsSync(srLegacyPath)) {
    const srLegacyData = JSON.parse(fs.readFileSync(srLegacyPath, 'utf-8'));
    srLegacyFoods = srLegacyData.SRLegacyFoods || [];
    console.log(`   ✅ SR Legacy Foods: ${srLegacyFoods.length} entries`);
  }
  
  const allUsdaFoods = [...foundationFoods, ...srLegacyFoods];
  console.log(`   📊 Total USDA entries: ${allUsdaFoods.length}\n`);
  
  let importedCount = 0;
  let skippedCount = 0;
  let aliasesCreated = 0;
  
  for (const foodSpec of FOODS_TO_IMPORT) {
    console.log(`\n🔍 Searching for: "${foodSpec.searchTerm}"`);
    
    // Search for matching foods
    const matches = allUsdaFoods.filter((food) => {
      const desc = food.description.toLowerCase();
      const searchLower = foodSpec.searchTerm.toLowerCase();
      
      // Must contain all words from search term
      const searchWords = searchLower.split(/\s+/);
      return searchWords.every((word) => desc.includes(word));
    });
    
    if (matches.length === 0) {
      console.log(`   ❌ No matches found`);
      skippedCount++;
      continue;
    }
    
    console.log(`   Found ${matches.length} matches`);
    
    // Prefer: raw > dried > roasted > others
    // Also prefer shorter names (more generic)
    const sortedMatches = matches.sort((a, b) => {
      const aDesc = a.description.toLowerCase();
      const bDesc = b.description.toLowerCase();
      
      // Prefer raw
      const aRaw = aDesc.includes('raw');
      const bRaw = bDesc.includes('raw');
      if (aRaw && !bRaw) return -1;
      if (!aRaw && bRaw) return 1;
      
      // Prefer dried
      const aDried = aDesc.includes('dried');
      const bDried = bDesc.includes('dried');
      if (aDried && !bDried) return -1;
      if (!aDried && bDried) return 1;
      
      // Prefer shorter (more generic) names
      return a.description.length - b.description.length;
    });
    
    const foodToImport = sortedMatches[0];
    console.log(`   ✅ Selected: "${foodToImport.description}"`);
    
    // Check if already exists (by name)
    const existing = await prisma.food.findFirst({
      where: {
        name: { equals: foodToImport.description, mode: 'insensitive' },
      },
    });
    
    if (existing) {
      console.log(`   ⏭️  Already exists: ${existing.name}`);
      skippedCount++;
      continue;
    }
    
    // Convert FDC format to UsdaRow format
    const usdaRow = fdcToUsdaRow(foodToImport as any);
    if (!usdaRow) {
      console.log(`   ❌ Failed to convert to UsdaRow format`);
      console.log(`   Debug: fdcId=${foodToImport.fdcId}, dataType=${foodToImport.dataType}`);
      skippedCount++;
      continue;
    }
    
    // Normalize nutrition data
    const normalized = normalizeUsdaRowToPer100g(usdaRow);
    if (!normalized) {
      console.log(`   ❌ Failed to normalize nutrition data`);
      console.log(`   Debug nutrients:`, JSON.stringify(usdaRow.nutrients, null, 2));
      console.log(`   Debug has kcal: ${usdaRow.nutrients?.kcal > 0}`);
      skippedCount++;
      continue;
    }
    
    const category = mapUsdaToCategory(foodToImport.description, foodToImport.foodCategory?.description);
    
    console.log(`   📊 Nutrition: ${normalized.kcal100} kcal, ${normalized.protein100}g protein, ${normalized.fat100}g fat`);
    console.log(`   🏷️  Category: ${category}`);
    console.log(`   🔗 Aliases: ${foodSpec.aliases.join(', ')}`);
    
    if (!dryRun) {
      // Import the food
      const food = await prisma.food.create({
        data: {
          name: foodToImport.description,
          source: 'usda',
          categoryId: category,
          kcal100: normalized.kcal100,
          protein100: normalized.protein100,
          carbs100: normalized.carbs100,
          fat100: normalized.fat100,
          fiber100: normalized.fiber100 || 0,
          sugar100: normalized.sugar100 || 0,
          densityGml: normalized.densityGml || null,
        },
      });
      
      console.log(`   ✅ Imported: ${food.id}`);
      
      // Add aliases
      for (const alias of foodSpec.aliases) {
        const aliasLower = alias.toLowerCase();
        if (aliasLower !== food.name.toLowerCase()) {
          await prisma.foodAlias.create({
            data: {
              foodId: food.id,
              alias: alias,
            },
          });
          aliasesCreated++;
        }
      }
      
      // Add standard cup portion for nuts (typical: 120-135g)
      await prisma.foodUnit.create({
        data: {
          foodId: food.id,
          label: 'cup',
          grams: 130, // Standard cup of nuts
        },
      });
      
      importedCount++;
    } else {
      console.log(`   🔍 Would import (dry run)`);
      importedCount++;
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   ✅ Imported: ${importedCount} foods`);
  console.log(`   ⏭️  Skipped: ${skippedCount} foods (already exist)`);
  console.log(`   🔗 Aliases created: ${aliasesCreated}`);
  console.log(`   📦 FoodUnits created: ${importedCount}`);
  
  if (dryRun) {
    console.log('\n💡 Run without --dry-run to import');
  } else {
    console.log('\n✅ Import complete!');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

