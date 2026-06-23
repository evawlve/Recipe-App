#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/db';
import { DEFAULT_SATURATION_FILTERS, UsdaSaturationFilters } from '../src/ops/usda/config';
import { normalizeUsdaRowToPer100g, fdcToUsdaRow, validateMacroSanity, StateTag } from '../src/ops/usda/normalize';
import { canonicalName, macroFingerprintSaturation, crossDatasetDedupeKey, shouldPreferItem, looseDedupeKey, areMacrosCloseEnough } from '../src/ops/usda/dedupe';
import { mapUsdaToCategory } from '../src/ops/usda/category-map';
import { CATEGORY_DEFAULTS } from '../src/ops/curated/category-defaults';
import { generateAliasesForFood, canonicalAlias } from '../src/ops/foods/alias-rules';

type RawUsda = any;

// Target foods to import (from gold.v3.csv failures + gap list)
const TARGET_KEYWORDS = [
  // Condiments
  'ketchup', 'catsup', 'vinegar distilled', 'sriracha sauce', 'vanilla extract',
  'baking powder', 'baking soda',
  // Broths
  'chicken broth', 'chicken bouillon', 'beef broth', 'beef bouillon',
  // Chicken cuts
  'chicken thigh', 'chicken drumstick', 'chicken wing',
  // International (from SPRINT_2_GAP_LIST.md)
  'miso', 'mirin', 'soy sauce', 'rice vinegar', 'gochujang', 'gochugaru',
  'fish sauce', 'coconut milk', 'curry paste',
];

// Modified filters that allow condiments and broths
function createTargetedFilters(): UsdaSaturationFilters {
  const filters = { ...DEFAULT_SATURATION_FILTERS };
  
  // Add exceptions for basic condiments and broths in exclude patterns
  // These will be handled in the matchesFilters function
  return filters;
}

function matchesFilters(row: RawUsda, f: UsdaSaturationFilters, categoryId?: string | null) {
  const dt = (row.dataType || row.data_type || '').toString();
  if (!f.includeDataTypes.some(t => dt.includes(t))) return false;
  
  const name = `${row.description||row.name||''}`.toLowerCase();
  const cat  = `${row.foodCategory || row.category || ''}`.toLowerCase();
  
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
  
  // EXCEPTIONS: Allow basic condiments and broths
  const allowedCondiments = [
    /\b(broth|bouillon|stock)\b/i,
    /\b(catsup|ketchup)\b/i,
    /\b(vinegar.*distilled|distilled.*vinegar|white vinegar)\b/i,
    /\b(sriracha.*sauce|sriracha)\b/i,
    /\b(vanilla.*extract|vanilla essence)\b/i,
    /\b(baking.*powder|leavening.*baking powder)\b/i,
    /\b(baking.*soda|sodium bicarbonate)\b/i,
    /\b(soy.*sauce|shoyu)\b/i,
    /\b(rice.*vinegar)\b/i,
    /\b(miso|soybean paste)\b/i,
    /\b(mirin)\b/i,
    /\b(gochujang|korean.*chili.*paste)\b/i,
    /\b(gochugaru|korean.*chili.*powder)\b/i,
    /\b(fish.*sauce|nam pla)\b/i,
    /\b(coconut.*milk)\b/i,
    /\b(curry.*paste)\b/i,
  ];
  
  // Check if this is an allowed condiment/broth
  const isAllowedCondiment = allowedCondiments.some(pattern => pattern.test(name));
  
  // Core staples (basic ingredients) get an exception for SOME patterns
  const coreStaples = ['oil', 'flour', 'meat', 'dairy', 'veg', 'fruit', 'legume', 'rice_uncooked', 'rice', 'oats', 'whey', 'cheese', 'sugar'];
  const isCoreStaple = categoryId && coreStaples.includes(categoryId);
  
  // Patterns that should NEVER be exempted (complex preparations)
  const alwaysExclude = [
    /\b(nuggets?|strips?|tenders?|fingers?|popcorn\s+chicken|taquitos?|turnovers?|quesadillas?)\b/i,
    /\b(with\s+(cheese|lettuce|tomato|sauce|gravy|vegetables?|bacon|ham|milk|butter|margarine|oil))\b/i,
    /\b(and\s+(cheese|vegetables?|rice|pasta|noodles|beans|potatoes?|butter|margarine|gravy|sauce|dressing))\b/i,
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
  
  // Skip alwaysExclude patterns unless it's an allowed condiment
  if (!isAllowedCondiment) {
    for (const pattern of alwaysExclude) {
      if (pattern.test(name)) return false;
    }
  }
  
  // Patterns that CAN be exempted for core staples (basic preparation terms)
  if (!isCoreStaple && !isAllowedCondiment) {
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

async function upsertFood(per100: any, meta: {name: string; brand?: string|null; categoryId: string|null}) {
  const idName = canonicalName(meta.name).replace(/\s+/g,'_').slice(0,80);
  const existing = await prisma.food.findFirst({
    where: {
      OR: [
        { name: meta.name },
        { aliases: { some: { alias: canonicalName(meta.name) } } }
      ]
    }
  });

  const units = CATEGORY_DEFAULTS[meta.categoryId || '']?.units ?? [];
  const data = {
    name: meta.name,
    brand: meta.brand ?? null,
    categoryId: meta.categoryId,
    source: 'usda' as const,
    verification: 'verified' as const,
    densityGml: CATEGORY_DEFAULTS[meta.categoryId || '']?.densityGml ?? null,
    kcal100: per100.kcal100, protein100: per100.protein100, carbs100: per100.carbs100, fat100: per100.fat100,
    fiber100: per100.fiber100 ?? null, sugar100: per100.sugar100 ?? null,
    popularity: 50,
    units: units.length ? { create: units } : undefined,
  };

  if (!existing) {
    const created = await prisma.food.create({ data });
    
    // Create aliases for the new food
    const extraAliases = [canonicalAlias(meta.name), ...generateAliasesForFood(meta.name, meta.categoryId)];
    await prisma.foodAlias.createMany({
      data: extraAliases.map(alias => ({ foodId: created.id, alias })),
      skipDuplicates: true
    });
    
    return { created: 1, updated: 0 };
  } else {
    await prisma.food.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1 };
  }
}

async function readJsonOrJsonl(filePath: string): Promise<any[]> {
  const full = path.resolve(filePath);
  const text = fs.readFileSync(full, 'utf-8');
  
  if (filePath.endsWith('.jsonl') || filePath.endsWith('.ndjson')) {
    return text.trim().split('\n').map(line => JSON.parse(line));
  }
  
  const parsed = JSON.parse(text);
  
  // Handle various JSON structures
  if (Array.isArray(parsed)) {
    return parsed;
  }
  
  // Handle wrapped formats like {"FoundationFoods": [...]}
  if (parsed.FoundationFoods) {
    return parsed.FoundationFoods;
  }
  
  if (parsed.SRLegacyFoods) {
    return parsed.SRLegacyFoods;
  }
  
  if (parsed.foods) {
    return parsed.foods;
  }
  
  // If it's a single object, wrap in array
  return [parsed];
}

async function processRows(rows: RawUsda[], opt: { filters?: UsdaSaturationFilters; dryRun?: boolean; keywords?: string[] }) {
  const f = opt.filters || DEFAULT_SATURATION_FILTERS;
  let created=0, updated=0, skipped=0, duped=0, macroFailed=0;

  // Cross-dataset deduplication map (using strict keys)
  const crossDatasetMap = new Map<string, { row: RawUsda; per100: any; metaName: string; cat: string|null; stateTag: StateTag }>();
  
  // Loose deduplication index for cross-dataset matching (ignores macro variations)
  const looseIndex = new Map<string, { row: RawUsda; per100: any; metaName: string; cat: string|null; stateTag: StateTag }[]>();

  // First pass: collect and dedupe across datasets
  for (const row of rows) {
    const metaName = (row.description || row.name || '').trim();
    if (!metaName) { skipped++; continue; }

    // Determine category early for filter check
    const cat = mapUsdaToCategory(metaName, row.foodCategory || row.category) || null;
    
    if (!matchesFilters(row, f, cat)) { skipped++; continue; }
    
    // Convert FDC format to UsdaRow format
    const usdaRow = fdcToUsdaRow(row);
    if (!usdaRow) { skipped++; continue; }
    
    const per100 = normalizeUsdaRowToPer100g(usdaRow);
    if (!per100) { skipped++; continue; }
    
    // Calorie bounds check
    if (per100.kcal100 < f.kcalMin || per100.kcal100 > f.kcalMax) { skipped++; continue; }
    
    // Require at least one macro
    if (f.requireMacros && per100.protein100 === 0 && per100.carbs100 === 0 && per100.fat100 === 0) {
      skipped++;
      continue;
    }
    
    // Macro sanity check
    if (!validateMacroSanity(per100.kcal100, per100.protein100, per100.carbs100, per100.fat100, f.macroSanityThreshold)) {
      macroFailed++;
      skipped++;
      continue;
    }

    // Skip if no category can be inferred
    if (!cat) { skipped++; continue; }

    // Two-level deduplication:
    // 1. Check loose key (ignores macro variations) - for cross-dataset duplicates
    // 2. Check strict key (includes macros) - for exact duplicates
    
    const looseKey = looseDedupeKey(metaName, cat, per100.stateTag || null);
    const strictKey = crossDatasetDedupeKey(metaName, cat, per100.stateTag || null, per100);
    
    // Check if we already have this exact food (strict match)
    const exactMatch = crossDatasetMap.get(strictKey);
    if (exactMatch) {
      // Same name, category, state, AND macros - prefer better dataset
      const portionCount = row.foodPortions?.length || 0;
      const existingPortionCount = exactMatch.row.foodPortions?.length || 0;
      
      if (shouldPreferItem(
        { dataType: row.dataType || '', description: metaName, portionCount },
        { dataType: exactMatch.row.dataType || '', description: exactMatch.metaName, portionCount: existingPortionCount }
      )) {
        crossDatasetMap.set(strictKey, { row, per100, metaName, cat, stateTag: per100.stateTag || null });
        // Update loose index too
        const looseMatches = looseIndex.get(looseKey) || [];
        const idx = looseMatches.findIndex(m => m === exactMatch);
        if (idx >= 0) looseMatches[idx] = { row, per100, metaName, cat, stateTag: per100.stateTag || null };
      }
      duped++;
      continue;
    }
    
    // Check if we have a SIMILAR food with different macros (loose match)
    const looseMatches = looseIndex.get(looseKey) || [];
    let isDuplicate = false;
    
    for (const candidate of looseMatches) {
      // Same name, category, state - check if macros are close enough
      if (areMacrosCloseEnough(per100, candidate.per100)) {
        // It's a cross-dataset duplicate! Prefer based on dataset precedence
        const portionCount = row.foodPortions?.length || 0;
        const candidatePortionCount = candidate.row.foodPortions?.length || 0;
        
        if (shouldPreferItem(
          { dataType: row.dataType || '', description: metaName, portionCount },
          { dataType: candidate.row.dataType || '', description: candidate.metaName, portionCount: candidatePortionCount }
        )) {
          // Replace candidate with this better version
          const candidateStrictKey = crossDatasetDedupeKey(candidate.metaName, candidate.cat, candidate.stateTag, candidate.per100);
          crossDatasetMap.delete(candidateStrictKey);
          crossDatasetMap.set(strictKey, { row, per100, metaName, cat, stateTag: per100.stateTag || null });
          
          // Update loose index
          const idx = looseMatches.findIndex(m => m === candidate);
          if (idx >= 0) looseMatches[idx] = { row, per100, metaName, cat, stateTag: per100.stateTag || null };
        }
        isDuplicate = true;
        duped++;
        break;
      }
    }
    
    if (isDuplicate) continue;
    
    // Not a duplicate - add to both maps
    crossDatasetMap.set(strictKey, { row, per100, metaName, cat, stateTag: per100.stateTag || null });
    looseMatches.push({ row, per100, metaName, cat, stateTag: per100.stateTag || null });
    looseIndex.set(looseKey, looseMatches);
  }

  // Second pass: check database and insert
  for (const { per100, metaName, cat } of crossDatasetMap.values()) {
    // Database duplicate check
    const canonical = canonicalName(metaName);
    const exists = await prisma.food.findFirst({
      where: {
        AND: [
          { OR: [{ name: metaName }, { aliases: { some: { alias: canonical } } }] },
          { kcal100: { gte: per100.kcal100-10, lte: per100.kcal100+10 } },
          { protein100: { gte: per100.protein100-2, lte: per100.protein100+2 } },
          { carbs100: { gte: per100.carbs100-2, lte: per100.carbs100+2 } },
          { fat100: { gte: per100.fat100-2, lte: per100.fat100+2 } },
        ]
      }
    });
    
    if (exists) { duped++; continue; }

    if (opt.dryRun) { created++; continue; }
    
    const res = await upsertFood(per100, { name: metaName, brand: null, categoryId: cat });
    created += res.created;
    updated += res.updated;
  }

  return { created, updated, skipped, duped, macroFailed };
}

(async function main(){
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  // Default USDA file paths
  const defaultFiles = [
    './data/usda/FoodData_Central_foundation_food_json_2025-04-24.json',
    './data/usda/FoodData_Central_sr_legacy_food_json_2018-04.json',
  ];
  
  const filesArg = args.find(a => a.startsWith('--files='))?.split('=')[1];
  const fileArgs = args.filter(a => a.startsWith('--file=')).map(a => a.split('=')[1]);
  
  let files: string[] = [];
  if (filesArg) {
    files = filesArg.split(',').map(s => s.trim()).filter(Boolean);
  } else if (fileArgs.length) {
    files = fileArgs;
  } else {
    files = defaultFiles;
  }

  console.log(`📁 Loading ${files.length} file(s)...`);
  
  // Load all files
  let allRows: any[] = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.warn(`⚠️  File not found: ${file}, skipping...`);
      continue;
    }
    console.log(`  Loading ${file}...`);
    const rows = await readJsonOrJsonl(file);
    console.log(`  Loaded ${rows.length} rows from ${path.basename(file)}`);
    allRows.push(...rows);
  }

  console.log(`📊 Total rows loaded: ${allRows.length}`);
  
  // Filter by target keywords
  console.log(`🔍 Filtering by target keywords: ${TARGET_KEYWORDS.join(', ')}`);
  const filteredRows = TARGET_KEYWORDS.flatMap(keyword => {
    const keywordRows = allRows.filter((r: any) => {
      const name = `${r.description || r.name || ''}`.toLowerCase();
      return name.includes(keyword.toLowerCase());
    });
    return keywordRows.slice(0, 10); // Max 10 per keyword
  });
  
  console.log(`📊 After keyword filter: ${filteredRows.length} rows`);

  console.log(`\n🚀 Processing ${filteredRows.length} rows${dryRun ? ' (DRY RUN)' : ''}...\n`);
  
  const filters = createTargetedFilters();
  const res = await processRows(filteredRows, { 
    filters,
    dryRun,
    keywords: TARGET_KEYWORDS
  });
  
  console.log('\n✅ Results:');
  console.log(JSON.stringify({ ...res, totalInput: filteredRows.length }, null, 2));
  
  if (dryRun) {
    console.log('\n💡 This was a dry run. Remove --dry-run to actually import.');
  }
})();
