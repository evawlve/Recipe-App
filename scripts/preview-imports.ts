#!/usr/bin/env ts-node
/**
 * Preview what foods would be imported without actually importing them
 * Outputs a detailed list of foods that pass filters
 */

import fs from 'fs';
import path from 'path';
import { DEFAULT_SATURATION_FILTERS } from '../src/ops/usda/config';
import { normalizeUsdaRowToPer100g, fdcToUsdaRow, validateMacroSanity } from '../src/ops/usda/normalize';
import { canonicalName, crossDatasetDedupeKey, looseDedupeKey, areMacrosCloseEnough, shouldPreferItem } from '../src/ops/usda/dedupe';
import { mapUsdaToCategory } from '../src/ops/usda/category-map';

async function readJsonOrJsonl(filePath: string): Promise<any[]> {
  const full = path.resolve(filePath);
  const text = fs.readFileSync(full, 'utf-8');
  
  if (filePath.endsWith('.jsonl') || filePath.endsWith('.ndjson')) {
    return text.trim().split('\n').map(line => JSON.parse(line));
  }
  
  const parsed = JSON.parse(text);
  
  if (Array.isArray(parsed)) return parsed;
  if (parsed.FoundationFoods) return parsed.FoundationFoods;
  if (parsed.SRLegacyFoods) return parsed.SRLegacyFoods;
  if (parsed.foods) return parsed.foods;
  
  return [parsed];
}

function matchesFilters(row: any, f: typeof DEFAULT_SATURATION_FILTERS, categoryId?: string | null) {
  const dt = (row.dataType || row.data_type || '').toString();
  if (!f.includeDataTypes.some(t => dt.includes(t))) return false;
  
  const name = `${row.description||row.name||''}`.toLowerCase();
  const cat  = `${row.foodCategory?.description || row.foodCategory || row.category || ''}`.toLowerCase();
  
  // Basic substring exclusions (restaurant brands, supplements, etc.)
  // These are ALWAYS excluded, no exceptions
  if (f.excludeIfNameHas.some(x => name.includes(x.toLowerCase()))) return false;
  if (f.excludeIfCategoryHas.some(x => cat.includes(x.toLowerCase()))) return false;
  
  // Additional hard-coded restaurant patterns that might slip through
  const restaurantPatterns = [
    /\b(mcdonald|burger king|wendy|kfc|popeye|subway|taco bell|applebee|olive garden)\b/i,
    /\b(carrabba|cracker barrel|t\.g\.i|friday's|denny|chick-fil-a|pizza hut|domino)\b/i,
  ];
  
  for (const pattern of restaurantPatterns) {
    if (pattern.test(name)) return false;
  }
  
  // Regex pattern exclusions for prepared meals/combinations
  // Core staples (basic ingredients) get an exception for SOME patterns
  const coreStaples = ['oil', 'flour', 'meat', 'dairy', 'veg', 'fruit', 'legume', 'rice_uncooked', 'rice', 'oats', 'whey', 'cheese', 'sugar'];
  const isCoreStaple = categoryId && coreStaples.includes(categoryId);
  
  // Patterns that should NEVER be exempted (complex preparations)
  const alwaysExclude = [
    /\b(nuggets?|strips?|tenders?|fingers?|popcorn\s+chicken|taquitos?|turnovers?|quesadillas?)\b/i,
    /\b(with\s+(cheese|lettuce|tomato|sauce|gravy|vegetables?|bacon|ham|milk|butter|margarine|oil))\b/i,
    /\b(and\s+(cheese|vegetables?|rice|pasta|noodles|beans|potatoes?|butter|margarine))\b/i,
    /\b(platters?|combos?|supreme|kids|kits?)\b/i,
    /\b(custards?|puddings?|pies?|cakes?|cookies?|brownies?|tarts?|pastries?)\b/i,
    /\b(egg\s+rolls?|spring\s+rolls?|wontons?|dumplings?|dim\s+sum)\b/i,
    /\bbread\b(?!\s*(crumb|ing))/i,
    /\b(frozen.*breaded|breaded.*frozen)\b/i,
    // Prepared/processed potato products
    /\b(mashed|hash\s*browns?|french\s*frie[ds]?|fries|chips|crisps|scalloped|candied|puffs?|pancakes?)\b/i,
    // Preparation indicators
    /\b(home-prepared|ready-to-eat|refrigerated.*prepared)\b/i,
    // Processed snacks
    /\b(snacks?|granules?|flakes?)\b/i,
    // Prepared sauces (exclude most sauces except very basic ones)
    /\b(alfredo|pesto|barbecue|bbq|teriyaki|tartar|steak\s+sauce|cheese\s+sauce|cranberry\s+sauce|applesauce)\b/i,
    // Complete meals that mention sauce
    /\b(spaghetti|pasta|lasagna|ravioli).*\bsauce\b/i,
  ];
  
  for (const pattern of alwaysExclude) {
    if (pattern.test(name)) return false;
  }
  
  // Patterns that CAN be exempted for core staples (basic preparation terms)
  // Example: "egg salad" would be excluded, but "olive oil" wouldn't be affected
  if (!isCoreStaple) {
    const conditionalExclude = [
      /\b(salad|casserole|entree|meal|sandwich|burrito|wrap|pot\s+pie)\b/i,
      /\b(filled|stuffed|topped|smothered)\b/i,
    ];
    
    for (const pattern of conditionalExclude) {
      if (pattern.test(name)) return false;
    }
  }
  
  return true;
}

(async function main() {
  const args = process.argv.slice(2);
  
  const filesArg = args.find(a => a.startsWith('--files='))?.split('=')[1];
  const kwArg = args.find(a => a.startsWith('--keywords='))?.split('=')[1];
  const maxPerKeyword = Number(args.find(a => a.startsWith('--max-per-keyword='))?.split('=')[1] || '100');
  
  if (!filesArg) {
    console.error('Usage: ts-node scripts/preview-imports.ts --files=<file1>,<file2> [--keywords=word1,word2] [--max-per-keyword=100]');
    process.exit(1);
  }
  
  const files = filesArg.split(',').map(s => s.trim()).filter(Boolean);
  const keywords = kwArg ? kwArg.split(',').map(s=>s.trim()).filter(Boolean) : [];
  
  console.log(`📁 Loading ${files.length} file(s)...`);
  
  let allRows: any[] = [];
  for (const file of files) {
    const rows = await readJsonOrJsonl(file);
    console.log(`  Loaded ${rows.length} rows from ${path.basename(file)}`);
    allRows.push(...rows);
  }
  
  let rowsToProcess = allRows;
  if (keywords.length) {
    rowsToProcess = keywords.flatMap(kw => {
      const kwRows = allRows.filter((r:any)=>`${r.description||r.name||''}`.toLowerCase().includes(kw.toLowerCase()));
      return kwRows.slice(0, maxPerKeyword);
    });
  }
  
  console.log(`\n🔍 Processing ${rowsToProcess.length} items...\n`);
  
  const f = DEFAULT_SATURATION_FILTERS;
  const foodsToImport: any[] = [];
  const dedupeMap = new Map<string, any>();
  const looseIndex = new Map<string, any[]>();
  
  let skipped = 0;
  let macroFailed = 0;
  let duped = 0;
  
  for (const row of rowsToProcess) {
    const metaName = (row.description || row.name || '').trim();
    if (!metaName) { skipped++; continue; }
    
    const cat = mapUsdaToCategory(metaName, row.foodCategory?.description || row.foodCategory || row.category) || null;
    
    if (!matchesFilters(row, f, cat)) { skipped++; continue; }
    
    const usdaRow = fdcToUsdaRow(row);
    if (!usdaRow) { skipped++; continue; }
    
    const per100 = normalizeUsdaRowToPer100g(usdaRow);
    if (!per100) { skipped++; continue; }
    
    if (per100.kcal100 < f.kcalMin || per100.kcal100 > f.kcalMax) { skipped++; continue; }
    
    if (f.requireMacros && per100.protein100 === 0 && per100.carbs100 === 0 && per100.fat100 === 0) {
      skipped++;
      continue;
    }
    
    if (!validateMacroSanity(per100.kcal100, per100.protein100, per100.carbs100, per100.fat100, f.macroSanityThreshold)) {
      macroFailed++;
      skipped++;
      continue;
    }
    
    if (!cat) { skipped++; continue; }
    
    const looseKey = looseDedupeKey(metaName, cat, per100.stateTag || null);
    const strictKey = crossDatasetDedupeKey(metaName, cat, per100.stateTag || null, per100);
    
    const foodData = {
      name: metaName,
      category: cat,
      state: per100.stateTag || 'none',
      dataType: row.dataType || 'unknown',
      kcal: per100.kcal100,
      protein: per100.protein100,
      carbs: per100.carbs100,
      fat: per100.fat100,
      canonical: canonicalName(metaName),
      per100
    };
    
    // Check exact match
    if (dedupeMap.has(strictKey)) {
      const existing = dedupeMap.get(strictKey);
      if (shouldPreferItem(
        { dataType: row.dataType || '', description: metaName, portionCount: row.foodPortions?.length || 0 },
        { dataType: existing.dataType, description: existing.name, portionCount: 0 }
      )) {
        // Replace
        const idx = foodsToImport.findIndex(f => f === existing);
        if (idx >= 0) {
          foodsToImport[idx] = foodData;
          dedupeMap.set(strictKey, foodData);
        }
      }
      duped++;
      continue;
    }
    
    // Check loose match
    const looseMatches = looseIndex.get(looseKey) || [];
    let isDuplicate = false;
    
    for (const candidate of looseMatches) {
      if (areMacrosCloseEnough(per100, candidate.per100)) {
        if (shouldPreferItem(
          { dataType: row.dataType || '', description: metaName, portionCount: row.foodPortions?.length || 0 },
          { dataType: candidate.dataType, description: candidate.name, portionCount: 0 }
        )) {
          // Replace candidate
          const candidateStrictKey = crossDatasetDedupeKey(candidate.name, candidate.category, candidate.state === 'none' ? null : candidate.state, candidate.per100);
          dedupeMap.delete(candidateStrictKey);
          dedupeMap.set(strictKey, foodData);
          
          const idx = foodsToImport.findIndex(f => f === candidate);
          if (idx >= 0) foodsToImport[idx] = foodData;
          
          const looseIdx = looseMatches.findIndex(m => m === candidate);
          if (looseIdx >= 0) looseMatches[looseIdx] = foodData;
        }
        isDuplicate = true;
        duped++;
        break;
      }
    }
    
    if (isDuplicate) continue;
    
    // Not a duplicate - add it
    dedupeMap.set(strictKey, foodData);
    looseMatches.push(foodData);
    looseIndex.set(looseKey, looseMatches);
    foodsToImport.push(foodData);
  }
  
  // Sort by category, then by name
  foodsToImport.sort((a, b) => {
    if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '');
    return a.name.localeCompare(b.name);
  });
  
  console.log(`\n📊 Summary:`);
  console.log(`  Would import: ${foodsToImport.length}`);
  console.log(`  Duplicates detected: ${duped}`);
  console.log(`  Skipped (filters): ${skipped - duped - macroFailed}`);
  console.log(`  Macro sanity failed: ${macroFailed}`);
  console.log(`\n📝 Foods that would be imported:\n`);
  
  let currentCategory = '';
  for (const food of foodsToImport) {
    if (food.category !== currentCategory) {
      currentCategory = food.category;
      console.log(`\n[${currentCategory || 'NO CATEGORY'}]`);
    }
    console.log(`  - ${food.name} [${food.dataType}] (${food.kcal} kcal, P:${food.protein}g C:${food.carbs}g F:${food.fat}g) ${food.state !== 'none' ? `[${food.state}]` : ''}`);
  }
})();

