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

function regexOrSubstringMatch(text: string, hint?: string | null): boolean {
  if (!hint) return false;
  try {
    if (hint.includes('|') || hint.includes('.*')) {
      const re = new RegExp(hint, 'i');
      return re.test(text);
    }
  } catch {
    // ignore regex errors, fallback to substring
  }
  return text.toLowerCase().includes(hint.toLowerCase());
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
  const csvPath = args[0] || path.join(process.cwd(), 'eval', 'gold.fatsecret-sanity.csv');
  
  const finalPath = path.isAbsolute(csvPath)
    ? csvPath
    : path.join(process.cwd(), csvPath);

  if (!fs.existsSync(finalPath)) {
    console.error(`File not found: ${finalPath}`);
    process.exit(1);
  }

  const rows = await readGoldCsv(finalPath);
  const goldFileName = path.basename(finalPath);

  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`FatSecret Debug Analysis: ${goldFileName}`);
  console.log(`Total rows: ${rows.length}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const results: Array<{
    row: GoldRow;
    resolution: Awaited<ReturnType<typeof resolveIngredient>>;
    hintMatch: boolean;
    source: 'fatsecret' | 'local';
  }> = [];

  const fallbacks: Array<{
    row: GoldRow;
    resolution: Awaited<ReturnType<typeof resolveIngredient>>;
    reason: string;
    searchExpressions?: string[];
    fatsecretCandidates?: Array<{ id: string; name: string }>;
    fatsecretConfidence?: number | null;
  }> = [];

  const nameMismatches: Array<{
    row: GoldRow;
    resolution: Awaited<ReturnType<typeof resolveIngredient>>;
    expectedHint: string | null;
    resolvedName: string | null;
  }> = [];

  for (const row of rows) {
    if (!row.id || !row.raw_line) continue;

    try {
      const resolution = await resolveIngredient(row.raw_line, { preferFatsecret: true });

      const topName = resolution.fatsecret?.foodName ?? resolution.local?.foodName ?? null;
      const hintMatch = topName
        ? regexOrSubstringMatch(topName, row.expected_food_id_hint || null) ||
          topName.toLowerCase().includes((row.expected_food_name || '').toLowerCase())
        : false;

      results.push({
        row,
        resolution,
        hintMatch,
        source: resolution.source,
      });

      // Track fallbacks to local
      if (resolution.source === 'local') {
        let reason = 'no_fatsecret_match';
        let fatsecretConfidence: number | null = null;
        
        if (resolution.fatsecret) {
          fatsecretConfidence = resolution.fatsecret.confidence;
          // Include confidence even when strict mode drops the match
          if (FATSECRET_STRICT_MODE) {
            reason = `low_confidence (${fatsecretConfidence.toFixed(2)} < threshold, strict_mode=true)`;
          } else {
            reason = `very_low_confidence (${fatsecretConfidence.toFixed(2)} < 0.3)`;
          }
        }
        
        // Capture debug info: search expressions and candidates
        const parsed = parseIngredientLine(row.raw_line);
        const searchExpressions = buildSearchExpressions(parsed, row.raw_line);
        
        // Get top candidates by calling mapIngredientWithFatsecret with minConfidence 0
        let fatsecretCandidates: Array<{ id: string; name: string }> = [];
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
          
          fatsecretCandidates = allCandidates.slice(0, 3); // Top 3
        } catch (err) {
          // Ignore errors in debug collection
        }
        
        fallbacks.push({
          row,
          resolution,
          reason,
          searchExpressions,
          fatsecretCandidates,
          fatsecretConfidence,
        });
      }

      // Track name mismatches for FatSecret results
      if (resolution.source === 'fatsecret' && !hintMatch && topName) {
        nameMismatches.push({
          row,
          resolution,
          expectedHint: row.expected_food_id_hint || row.expected_food_name || null,
          resolvedName: topName,
        });
      }
    } catch (error) {
      console.error(`Error processing row ${row.id}:`, (error as Error).message);
    }
  }

  // Calculate statistics
  const sourceCounts = results.reduce((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const fatsecretCount = sourceCounts.fatsecret ?? 0;
  const localCount = sourceCounts.local ?? 0;
  const total = results.length;
  const fatsecretRate = total > 0 ? (fatsecretCount / total) * 100 : 0;

  // Print summary
  console.log(`Summary:`);
  console.log(`  Total processed: ${total}`);
  console.log(`  FatSecret: ${fatsecretCount} (${fatsecretRate.toFixed(1)}%)`);
  console.log(`  Local fallback: ${localCount} (${((localCount / total) * 100).toFixed(1)}%)`);
  console.log(`  Name mismatches (FatSecret): ${nameMismatches.length}`);
  console.log(`  Fallbacks to local: ${fallbacks.length}\n`);

  // Print fallbacks
  if (fallbacks.length > 0) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Fallbacks to Local (${fallbacks.length}):`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    for (const { row, resolution, reason, searchExpressions, fatsecretCandidates, fatsecretConfidence } of fallbacks.slice(0, 20)) {
      const topName = resolution.local?.foodName ?? 'N/A';
      const servingDesc = resolution.local?.portionSource ?? 'N/A';
      console.log(`[${row.id}] ${row.raw_line}`);
      console.log(`  Reason: ${reason}`);
      console.log(`  Expected: ${row.expected_food_name}`);
      console.log(`  Resolved (local): ${topName}`);
      console.log(`  Serving: ${servingDesc}, Grams: ${resolution.grams}, Kcal: ${resolution.kcal.toFixed(0)}`);
      console.log(`  Local confidence: ${resolution.confidence.toFixed(2)}`);
      // Include fatsecretConfidence even when strict mode drops the match
      if (fatsecretConfidence !== null && fatsecretConfidence !== undefined) {
        console.log(`  FatSecret confidence: ${fatsecretConfidence.toFixed(2)}`);
      }
      if (resolution.fatsecret) {
        console.log(`  FatSecret tried: ${resolution.fatsecret.foodName}`);
        console.log(`  FATSECRET_STRICT_MODE: ${FATSECRET_STRICT_MODE ? 'true' : 'false'}`);
        if (FATSECRET_STRICT_MODE && resolution.fatsecret.confidence < 0.7) {
          console.log(`  → Strict mode rejected (confidence ${resolution.fatsecret.confidence.toFixed(2)} < threshold)`);
        }
      }
      // Debug info: search expressions and candidates
      if (searchExpressions && searchExpressions.length > 0) {
        console.log(`  Search expressions: [${searchExpressions.join(', ')}]`);
      }
      if (fatsecretCandidates && fatsecretCandidates.length > 0) {
        console.log(`  FatSecret candidates (${fatsecretCandidates.length}):`);
        for (const cand of fatsecretCandidates.slice(0, 3)) {
          console.log(`    - ${cand.name} (${cand.id})`);
        }
      } else if (searchExpressions) {
        console.log(`  FatSecret candidates: 0 (API returned no foods for any expression)`);
      }
      console.log('');
    }
    
    if (fallbacks.length > 20) {
      console.log(`... and ${fallbacks.length - 20} more fallbacks\n`);
    }
  }

  // Print name mismatches
  if (nameMismatches.length > 0) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Name Mismatches (FatSecret) (${nameMismatches.length}):`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    for (const { row, resolution, expectedHint, resolvedName } of nameMismatches.slice(0, 20)) {
      const fatsecret = resolution.fatsecret!;
      console.log(`[${row.id}] ${row.raw_line}`);
      console.log(`  Expected hint: ${expectedHint || row.expected_food_name}`);
      console.log(`  Resolved: ${resolvedName}`);
      console.log(`  Brand: ${fatsecret.brandName || 'N/A'}`);
      console.log(`  Serving: ${fatsecret.servingDescription || 'N/A'}, Grams: ${fatsecret.grams}, Kcal: ${fatsecret.kcal}`);
      console.log(`  Confidence: ${fatsecret.confidence.toFixed(2)}`);
      console.log('');
    }
    
    if (nameMismatches.length > 20) {
      console.log(`... and ${nameMismatches.length - 20} more mismatches\n`);
    }
  }

  // Print detailed breakdown
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`Detailed Breakdown:`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  const byReason = fallbacks.reduce((acc, f) => {
    const reason = f.reason;
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`Fallback reasons:`);
  for (const [reason, count] of Object.entries(byReason)) {
    console.log(`  ${reason}: ${count}`);
  }

  const avgConfidence = {
    fatsecret: results
      .filter(r => r.resolution.fatsecret)
      .reduce((sum, r) => sum + (r.resolution.fatsecret!.confidence || 0), 0) / fatsecretCount || 0,
    local: results
      .filter(r => r.resolution.source === 'local')
      .reduce((sum, r) => sum + r.resolution.confidence, 0) / localCount || 0,
  };

  console.log(`\nAverage confidence:`);
  console.log(`  FatSecret: ${avgConfidence.fatsecret.toFixed(2)}`);
  console.log(`  Local: ${avgConfidence.local.toFixed(2)}`);
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exit(1);
});



