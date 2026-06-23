#!/usr/bin/env ts-node

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deep analysis of failure patterns in gold.short.csv
 * Categorizes failures to identify systemic issues
 */

interface Failure {
  id: string;
  raw_line: string;
  expected_food_name: string;
  expected_grams: number;
  top_food_name: string | null;
  resolved_grams: number;
  mae: number;
}

function categorizeFailure(f: Failure): string[] {
  const categories: string[] = [];
  const query = f.raw_line.toLowerCase();
  const expected = f.expected_food_name.toLowerCase();
  const got = f.top_food_name?.toLowerCase() || 'NO MATCH';
  
  // NO MATCH cases
  if (f.top_food_name === null) {
    categories.push('NO_MATCH');
    
    // Why no match?
    if (query.includes('block')) categories.push('NO_MATCH_BLOCK_UNIT');
    if (query.includes('floret')) categories.push('NO_MATCH_FLORET_ALIAS');
    if (query.includes('protein powder')) categories.push('NO_MATCH_PROTEIN_POWDER');
    if (query.includes('whey')) categories.push('NO_MATCH_WHEY');
    if (query.includes('casein')) categories.push('NO_MATCH_CASEIN');
    return categories;
  }
  
  // WRONG MATCH cases
  categories.push('WRONG_MATCH');
  
  // Pattern 1: Volume portion issues (right food, wrong grams)
  if (expected.includes(got.split(',')[0].trim()) || got.includes(expected.split(',')[0].trim())) {
    if (query.includes('cup') || query.includes('tbsp') || query.includes('tsp')) {
      const expectedGrams = f.expected_grams;
      const gotGrams = f.resolved_grams;
      const ratio = gotGrams / expectedGrams;
      
      if (ratio < 0.3) {
        categories.push('VOLUME_PORTION_TOO_LOW'); // Getting ~60g instead of 200g+
        if (gotGrams === 60 || gotGrams === 56.4 || gotGrams === 54.6) {
          categories.push('VOLUME_DEFAULT_60G'); // Hardcoded default
        }
      }
    }
  }
  
  // Pattern 2: Cooked vs Raw mismatch
  if (query.includes('cooked') && !got.includes('cooked') && !got.includes('broiled') && !got.includes('grilled')) {
    categories.push('COOKED_VS_RAW');
  }
  if (!query.includes('cooked') && !query.includes('raw') && got.includes('cooked')) {
    categories.push('RAW_VS_COOKED');
  }
  
  // Pattern 3: Derivative/condiment matching base ingredient
  if (query.includes('tomato') && !query.includes('sauce') && !query.includes('ketchup') && 
      (got.includes('sauce') || got.includes('ketchup') || got.includes('paste'))) {
    categories.push('DERIVATIVE_MATCH_BASE');
  }
  if (query.includes('coconut oil') && got.includes('coconut milk')) {
    categories.push('DERIVATIVE_MATCH_BASE');
  }
  if (query.includes('coconut oil') && got.includes('yogurt') && got.includes('coconut')) {
    categories.push('DERIVATIVE_MATCH_BASE');
  }
  
  // Pattern 4: Wrong category (e.g., salt → tuna, oat milk → chocolate)
  const expectedCategory = inferCategory(expected);
  const gotCategory = inferCategory(got);
  if (expectedCategory && gotCategory && expectedCategory !== gotCategory) {
    categories.push(`WRONG_CATEGORY_${expectedCategory}_VS_${gotCategory}`);
  }
  
  // Pattern 5: Preparation qualifier mismatch (diced, sliced, chopped)
  if (query.includes('diced') || query.includes('chopped') || query.includes('sliced')) {
    if (got.includes('sauce') || got.includes('canned') || got.includes('frozen')) {
      categories.push('PREP_QUALIFIER_MISMATCH');
    }
  }
  
  // Pattern 6: Specific cut/part mismatch
  if (query.includes('ground beef') && !got.includes('ground')) {
    categories.push('CUT_PART_MISMATCH');
  }
  
  // Pattern 7: Brand/type mismatch (e.g., "2% milk" → whole milk)
  if (query.match(/\b(2%|1%|skim|whole|lowfat)\b/) && !got.includes(query.match(/\b(2%|1%|skim|whole|lowfat)\b/)![0])) {
    categories.push('FAT_PERCENTAGE_MISMATCH');
  }
  
  return categories;
}

function inferCategory(foodName: string): string | null {
  const name = foodName.toLowerCase();
  if (name.includes('salt') || name.includes('pepper')) return 'condiment';
  if (name.includes('milk') && !name.includes('coconut') && !name.includes('oat') && !name.includes('almond')) return 'dairy';
  if (name.includes('oil')) return 'oil';
  if (name.includes('tomato') && !name.includes('sauce') && !name.includes('paste')) return 'vegetable';
  if (name.includes('beef') || name.includes('chicken') || name.includes('salmon')) return 'protein';
  if (name.includes('cheese')) return 'dairy';
  if (name.includes('yogurt')) return 'dairy';
  return null;
}

async function main() {
  console.log('🔍 Deep Analysis of Failure Patterns\n');
  console.log('='.repeat(80));
  
  // Read latest eval report
  const reportPath = path.join(process.cwd(), 'reports', 'eval-baseline-20251112.json');
  if (!fs.existsSync(reportPath)) {
    console.error(`❌ Report not found: ${reportPath}`);
    console.error('Please run: npm run eval first');
    process.exit(1);
  }
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const failures: Failure[] = (report.allResults || []).filter((r: any) => r.pAt1 === 0);
  
  console.log(`\n📊 Analyzing ${failures.length} failures...\n`);
  
  // Categorize all failures
  const categoryCounts: Record<string, number> = {};
  const failuresByCategory: Record<string, Failure[]> = {};
  
  for (const failure of failures) {
    const categories = categorizeFailure(failure);
    for (const cat of categories) {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      if (!failuresByCategory[cat]) {
        failuresByCategory[cat] = [];
      }
      failuresByCategory[cat].push(failure);
    }
  }
  
  // Sort categories by frequency
  const sortedCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1]);
  
  console.log('📈 Failure Categories (by frequency):\n');
  for (const [category, count] of sortedCategories) {
    const percentage = ((count / failures.length) * 100).toFixed(1);
    console.log(`   ${category.padEnd(40)} ${count.toString().padStart(3)} cases (${percentage}%)`);
  }
  
  // Show examples for top categories
  console.log('\n\n🔬 Top Pattern Examples:\n');
  console.log('='.repeat(80));
  
  const topCategories = sortedCategories.slice(0, 5);
  for (const [category, count] of topCategories) {
    console.log(`\n📋 ${category} (${count} cases):\n`);
    const examples = failuresByCategory[category].slice(0, 5);
    for (const ex of examples) {
      console.log(`   Query: "${ex.raw_line}"`);
      console.log(`   Expected: ${ex.expected_food_name} (${ex.expected_grams}g)`);
      console.log(`   Got: ${ex.top_food_name || 'NO MATCH'} (${ex.resolved_grams}g)`);
      console.log(`   MAE: ${ex.mae.toFixed(1)}g\n`);
    }
  }
  
  // Summary recommendations
  console.log('\n\n💡 Recommended Fixes (by impact):\n');
  console.log('='.repeat(80));
  
  if (categoryCounts['VOLUME_PORTION_TOO_LOW'] || categoryCounts['VOLUME_DEFAULT_60G']) {
    const count = (categoryCounts['VOLUME_PORTION_TOO_LOW'] || 0) + (categoryCounts['VOLUME_DEFAULT_60G'] || 0);
    console.log(`\n1. 🔧 Fix Volume Portion Resolution (${count} cases)`);
    console.log('   Issue: "1 cup" queries defaulting to 60g instead of using densityGml');
    console.log('   Fix: Ensure resolveGramsFromParsed prefers exact "1 cup" matches from densityGml');
    console.log('   Impact: High - fixes multiple volume portion failures');
  }
  
  if (categoryCounts['DERIVATIVE_MATCH_BASE']) {
    console.log(`\n2. 🔧 Strengthen Derivative Penalties (${categoryCounts['DERIVATIVE_MATCH_BASE']} cases)`);
    console.log('   Issue: Condiments/derivatives matching base ingredients');
    console.log('   Fix: Increase penalty or add more derivative mappings');
    console.log('   Impact: Medium - fixes tomato→sauce, coconut oil→yogurt');
  }
  
  if (categoryCounts['COOKED_VS_RAW']) {
    console.log(`\n3. 🔧 Improve Cooked State Matching (${categoryCounts['COOKED_VS_RAW']} cases)`);
    console.log('   Issue: "cooked" queries finding raw foods');
    console.log('   Fix: Strengthen stateBoost penalty for mismatches');
    console.log('   Impact: Medium - fixes ground beef cooked, salmon cooked');
  }
  
  if (categoryCounts['NO_MATCH']) {
    console.log(`\n4. 🔧 Add Missing Foods/Aliases (${categoryCounts['NO_MATCH']} cases)`);
    console.log('   Issue: Foods not found in database');
    console.log('   Fix: Add missing foods or aliases');
    console.log('   Impact: High - fixes all NO MATCH cases');
  }
  
  console.log('\n');
}

main().catch(console.error);

