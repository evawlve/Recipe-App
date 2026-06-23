import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { resolveIngredient } from '@/lib/nutrition/resolve-ingredient';
import { mapIngredientWithFatsecret } from '@/lib/fatsecret/map-ingredient';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { FatSecretClient } from '@/lib/fatsecret/client';
import { buildSearchExpressions } from '@/lib/fatsecret/map-ingredient';
import { FATSECRET_STRICT_MODE } from '@/lib/fatsecret/config';

interface GoldRow {
  id: string;
  raw_line: string;
  expected_food_name: string;
  expected_grams: string | number;
  expected_source: string;
  expected_source_tier?: string;
  expected_food_id_hint?: string;
  expected_unit_hint?: string;
  notes?: string;
}

async function readGoldCsv(filePath: string): Promise<GoldRow[]> {
  const csv = await fs.promises.readFile(filePath, 'utf8');
  const parsed = Papa.parse<GoldRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    throw new Error(`CSV parse errors: ${parsed.errors.map(e => e.message).join('; ')}`);
  }
  return parsed.data;
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args[0] || path.join(process.cwd(), 'eval', 'gold.fatsecret-problems.csv');
  
  const finalPath = path.isAbsolute(csvPath)
    ? csvPath
    : path.join(process.cwd(), csvPath);

  if (!fs.existsSync(finalPath)) {
    console.error(`File not found: ${finalPath}`);
    process.exit(1);
  }

  const rows = await readGoldCsv(finalPath);
  const goldFileName = path.basename(finalPath);

  console.log('='.repeat(40));
  console.log(`FatSecret Problem Debug: ${goldFileName}`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`FATSECRET_STRICT_MODE: ${FATSECRET_STRICT_MODE ? 'true' : 'false'}`);
  console.log('='.repeat(40) + '\n');

  const results: Array<{
    row: GoldRow;
    resolution: Awaited<ReturnType<typeof resolveIngredient>>;
    mapResult: Awaited<ReturnType<typeof mapIngredientWithFatsecret>> | null;
    searchExpressions: string[];
    candidates: Array<{ id: string; name: string; score?: number }>;
    strictModeRejected: boolean;
  }> = [];

  for (const row of rows) {
    if (!row.id || !row.raw_line) continue;

    try {
      // Get resolution
      const resolution = await resolveIngredient(row.raw_line, { preferFatsecret: true });
      
      // Get direct map result (bypasses resolver thresholds)
      const mapResult = await mapIngredientWithFatsecret(row.raw_line, { minConfidence: 0 });
      
      // Capture search expressions and candidates
      const parsed = parseIngredientLine(row.raw_line);
      const searchExpressions = buildSearchExpressions(parsed, row.raw_line);
      
      // Get candidates from API
      const candidates: Array<{ id: string; name: string }> = [];
      try {
        const client = new FatSecretClient();
        const allCandidates: Array<{ id: string; name: string }> = [];
        const seenIds = new Set<string>();
        
        for (const query of searchExpressions) {
          try {
            const foods = await client.searchFoodsV4(query, { maxResults: 15 });
            for (const food of foods) {
              if (!seenIds.has(food.id)) {
                seenIds.add(food.id);
                allCandidates.push({ id: food.id, name: food.name });
              }
            }
          } catch (err) {
            // Continue
          }
        }
        
        candidates.push(...allCandidates.slice(0, 5)); // Top 5
      } catch (err) {
        // Ignore errors in debug collection
      }
      
      // Check if strict mode rejected a result
      const strictModeRejected = mapResult !== null && 
                                  resolution.source === 'local' && 
                                  resolution.fatsecret !== null &&
                                  FATSECRET_STRICT_MODE &&
                                  mapResult.confidence < 0.7;
      
      results.push({
        row,
        resolution,
        mapResult,
        searchExpressions,
        candidates,
        strictModeRejected,
      });
    } catch (error) {
      console.error(`Error processing row ${row.id}:`, (error as Error).message);
    }
  }

  // Calculate statistics
  const sourceCounts = results.reduce((acc, r) => {
    acc[r.resolution.source] = (acc[r.resolution.source] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const fatsecretCount = sourceCounts.fatsecret ?? 0;
  const localCount = sourceCounts.local ?? 0;
  const strictModeRejections = results.filter(r => r.strictModeRejected).length;
  const total = results.length;
  const fatsecretRate = total > 0 ? (fatsecretCount / total) * 100 : 0;

  // Print summary
  console.log('Summary:');
  console.log(`  Total processed: ${total}`);
  console.log(`  FatSecret: ${fatsecretCount} (${fatsecretRate.toFixed(1)}%)`);
  console.log(`  Local fallback: ${localCount} (${((localCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Strict mode rejections: ${strictModeRejections}`);
  const avgConfidence = results.filter(r => r.mapResult).reduce((sum, r) => sum + (r.mapResult?.confidence || 0), 0) / (results.filter(r => r.mapResult).length || 1) || 0;
  console.log(`  Average FatSecret confidence: ${avgConfidence.toFixed(2)}\n`);

  // Print detailed results
  console.log('='.repeat(40));
  console.log('Detailed Results:');
  console.log('='.repeat(40) + '\n');
  
  for (const { row, resolution, mapResult, searchExpressions, candidates, strictModeRejected } of results) {
    const topName = resolution.fatsecret?.foodName ?? resolution.local?.foodName ?? 'N/A';
    const servingDesc = resolution.fatsecret?.servingDescription ?? resolution.local?.portionSource ?? 'N/A';
    
    console.log(`[${row.id}] ${row.raw_line}`);
    console.log(`  Source: ${resolution.source}`);
    console.log(`  Confidence: ${resolution.confidence.toFixed(2)}`);
    console.log(`  Expected: ${row.expected_food_name}`);
    console.log(`  Resolved: ${topName}`);
    console.log(`  Serving: ${servingDesc}, Grams: ${resolution.grams}, Kcal: ${resolution.kcal.toFixed(0)}`);
    
    if (mapResult) {
      console.log('  mapIngredientWithFatsecret result:');
      console.log(`    Food: ${mapResult.foodName}`);
      console.log(`    Confidence: ${mapResult.confidence.toFixed(2)}`);
      console.log(`    Grams: ${mapResult.grams}, Kcal: ${mapResult.kcal}`);
      if (strictModeRejected) {
        console.log(`    [WARNING] STRICT MODE REJECTED (confidence ${mapResult.confidence.toFixed(2)} < threshold)`);
      }
    } else {
      console.log('  mapIngredientWithFatsecret: null (no match)');
    }
    
    const exprPreview = searchExpressions.slice(0, 5).join(', ') + (searchExpressions.length > 5 ? '...' : '');
    console.log(`  Search expressions (${searchExpressions.length}): [${exprPreview}]`);
    
    if (candidates.length > 0) {
      const topCount = Math.min(5, candidates.length);
      console.log(`  FatSecret candidates (top ${topCount}):`);
      for (const cand of candidates.slice(0, 5)) {
        console.log(`    - ${cand.name} (${cand.id})`);
      }
    } else {
      console.log('  FatSecret candidates: 0 (API returned no foods)');
    }
    
    console.log('');
  }

  // Print strict mode rejections summary
  if (strictModeRejections > 0) {
    console.log('='.repeat(40));
    console.log(`Strict Mode Rejections (${strictModeRejections}):`);
    console.log('='.repeat(40) + '\n');
    
    for (const { row, mapResult } of results.filter(r => r.strictModeRejected)) {
      console.log(`[${row.id}] ${row.raw_line}`);
      console.log(`  FatSecret found: ${mapResult?.foodName}`);
      console.log(`  Confidence: ${mapResult?.confidence.toFixed(2)} (rejected by strict mode)`);
      console.log('  Would be accepted in non-strict mode (>= 0.3)');
      console.log('');
    }
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});

