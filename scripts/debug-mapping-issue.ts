/**
 * Debug Mapping Issue Script
 * 
 * Investigates why an ingredient maps incorrectly by showing:
 * 1. AI normalized name (the actual search query)
 * 2. Raw API results from FatSecret and FDC
 * 3. Post-filtering candidates
 * 4. Post-scoring candidates with score breakdown
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --ingredient "3 fl oz single cream"
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --search "light cream"
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-mapping-issue.ts --from-log "logs/mapping-analysis-2026-01-05.json" --index 5
 */

import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';
import { gatherCandidates, type UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens } from '../src/lib/fatsecret/filter-candidates';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';
import fs from 'fs';
import path from 'path';

// ============================================================
// CLI Argument Parsing
// ============================================================

interface CliArgs {
    ingredient?: string;
    search?: string;
    fromLog?: string;
    index?: number;
    showRaw?: boolean;
}

function parseArgs(): CliArgs {
    const args: CliArgs = {};
    const argv = process.argv.slice(2);

    for (let i = 0; i < argv.length; i++) {
        switch (argv[i]) {
            case '--ingredient':
            case '-i':
                args.ingredient = argv[++i];
                break;
            case '--search':
            case '-s':
                args.search = argv[++i];
                break;
            case '--from-log':
            case '-l':
                args.fromLog = argv[++i];
                break;
            case '--index':
            case '-n':
                args.index = parseInt(argv[++i], 10);
                break;
            case '--show-raw':
            case '-r':
                args.showRaw = true;
                break;
            case '--help':
            case '-h':
                printUsage();
                process.exit(0);
        }
    }

    return args;
}

function printUsage() {
    console.log(`
Debug Mapping Issue Script

Usage:
  npx ts-node scripts/debug-mapping-issue.ts [options]

Options:
  --ingredient, -i <line>    Debug a full ingredient line (e.g., "3 fl oz single cream")
  --search, -s <query>       Debug just a search query (skips AI normalization)
  --from-log, -l <file>      Load ingredient from mapping analysis JSON file
  --index, -n <number>       Index of ingredient in log file (0-based)
  --show-raw, -r             Show raw API response data
  --help, -h                 Show this help message

Examples:
  npx ts-node scripts/debug-mapping-issue.ts --ingredient "1 cup unsweetened coconut milk"
  npx ts-node scripts/debug-mapping-issue.ts --search "light cream"
  npx ts-node scripts/debug-mapping-issue.ts --from-log logs/mapping-analysis-2026-01-05.json --index 5
`);
}

// ============================================================
// Pretty Printing Helpers
// ============================================================

function printHeader(title: string) {
    const line = '='.repeat(70);
    console.log(`\n${line}`);
    console.log(`  ${title}`);
    console.log(line);
}

function printSubHeader(title: string) {
    console.log(`\n--- ${title} ---\n`);
}

function printCandidate(c: UnifiedCandidate, rank: number) {
    const brand = c.brandName ? ` (${c.brandName})` : '';
    const source = c.source.toUpperCase().padEnd(9);
    const score = c.score.toFixed(3);

    console.log(`  ${rank}. [${source}] ${c.name}${brand}`);
    console.log(`     Score: ${score} | ID: ${c.id}`);

    if (c.nutrition) {
        console.log(`     Nutrition: ${c.nutrition.kcal} kcal, P:${c.nutrition.protein}g, C:${c.nutrition.carbs}g, F:${c.nutrition.fat}g per 100g`);
    }
}

// ============================================================
// Main Debug Flow
// ============================================================

async function debugIngredient(rawLine: string) {
    printHeader(`DEBUGGING: "${rawLine}"`);

    // Step 1: Parse ingredient
    printSubHeader('Step 1: Parsing');
    const parsed = parseIngredientLine(rawLine);
    if (parsed) {
        console.log(`  Quantity: ${parsed.qty}`);
        console.log(`  Unit: ${parsed.unit || '(none)'}`);
        console.log(`  Name: ${parsed.name}`);
        console.log(`  Qualifiers: ${parsed.qualifiers?.join(', ') || '(none)'}`);
    } else {
        console.log('  ❌ Failed to parse ingredient line');
    }

    // Step 2: Basic normalization
    printSubHeader('Step 2: Basic Normalization');
    const baseName = parsed?.name || rawLine;
    const basicNormalized = normalizeIngredientName(baseName);
    console.log(`  Input: "${baseName}"`);
    console.log(`  Cleaned: "${basicNormalized.cleaned}"`);
    console.log(`  Modifiers: ${basicNormalized.modifiers?.join(', ') || '(none)'}`);

    // Step 3: AI Normalization
    printSubHeader('Step 3: AI Normalization');
    console.log('  Calling AI normalize...');
    const aiResult = await aiNormalizeIngredient(rawLine);

    if (aiResult.status === 'success') {
        console.log(`  ✅ Status: success`);
        console.log(`  📝 Normalized Name: "${aiResult.normalizedName}"`);
        console.log(`     ⚠️  This is the SEARCH QUERY sent to APIs`);
        console.log(`  Prep Phrases: ${aiResult.prepPhrases?.join(', ') || '(none)'}`);
        console.log(`  Size Phrases: ${aiResult.sizePhrases?.join(', ') || '(none)'}`);
        console.log(`  Synonyms: ${aiResult.synonyms?.join(', ') || '(none)'}`);
    } else {
        console.log(`  ❌ Status: ${aiResult.status}`);
        console.log(`  Reason: ${aiResult.reason || 'unknown'}`);
    }

    const searchQuery = aiResult.status === 'success'
        ? aiResult.normalizedName
        : basicNormalized.cleaned || baseName;

    // Step 4: Search APIs directly (raw results)
    await debugSearchQuery(searchQuery, parsed, aiResult.synonyms || [], rawLine);
}

async function debugSearchQuery(
    searchQuery: string,
    parsed: ReturnType<typeof parseIngredientLine> = null,
    aiSynonyms: string[] = [],
    originalRawLine?: string  // Add original raw line parameter
) {
    printSubHeader('Step 4: Raw API Searches');
    console.log(`  Search Query: "${searchQuery}"`);
    if (aiSynonyms.length > 0) {
        console.log(`  AI Synonyms: ${aiSynonyms.join(', ')}`);
    }

    // Search FatSecret directly
    console.log('\n  [FatSecret API]');
    const client = new FatSecretClient();
    try {
        const fsResults = await client.searchFoodsV4(searchQuery, { maxResults: 8 });
        console.log(`  Found ${fsResults.length} results:`);
        fsResults.forEach((f, i) => {
            const brand = f.brandName ? ` (${f.brandName})` : '';
            console.log(`    ${i + 1}. ${f.name}${brand} [ID: ${f.id}]`);
        });
    } catch (err) {
        console.log(`  ❌ Error: ${(err as Error).message}`);
    }

    // Search FDC directly
    console.log('\n  [FDC/USDA API]');
    try {
        const fdcResults = await fdcApi.searchFoods({ query: searchQuery, pageSize: 8 });
        const foods = fdcResults?.foods || [];
        console.log(`  Found ${foods.length} results:`);
        foods.forEach((f: any, i: number) => {
            console.log(`    ${i + 1}. ${f.description} [ID: ${f.fdcId}] [Type: ${f.dataType}]`);
        });
    } catch (err) {
        console.log(`  ❌ Error: ${(err as Error).message}`);
    }

    // Step 5: Gather candidates (unified)
    printSubHeader('Step 5: Unified Candidate Gathering');
    // Use original raw line if provided, otherwise construct from parsed (including qualifiers)
    const rawLine = originalRawLine || (parsed
        ? `${parsed.qty} ${parsed.unit || ''} ${parsed.qualifiers?.join(' ') || ''} ${parsed.name}`.trim().replace(/\s+/g, ' ')
        : searchQuery);

    const allCandidates = await gatherCandidates(rawLine, parsed, searchQuery, {
        aiSynonyms,
    });

    console.log(`  Total unique candidates: ${allCandidates.length}`);
    console.log('\n  Top 10 candidates (before filtering):');
    allCandidates.slice(0, 10).forEach((c, i) => printCandidate(c, i + 1));

    // Step 6: Filter candidates - pass ORIGINAL raw line for proper cooking state detection
    printSubHeader('Step 6: Filtering');
    const filterResult = filterCandidatesByTokens(allCandidates, searchQuery, { debug: true, rawLine: originalRawLine || rawLine });
    const filtered = filterResult.filtered;

    console.log(`  Kept: ${filtered.length} | Removed: ${filterResult.removedCount}`);

    if (filterResult.removedCount > 0) {
        console.log('\n  Removed candidates:');
        const removed = allCandidates.filter(c => !filtered.includes(c));
        removed.slice(0, 5).forEach((c) => {
            console.log(`    - ${c.name} (${c.source})`);
        });
        if (removed.length > 5) {
            console.log(`    ... and ${removed.length - 5} more`);
        }
    }

    // Step 7: Score and rank
    printSubHeader('Step 7: Scoring & Ranking');

    if (filtered.length === 0) {
        console.log('  ❌ No candidates survived filtering');
        return;
    }

    // Sort by score first
    const sorted = [...filtered].sort((a, b) => b.score - a.score);

    // Run simple rerank
    const rerankCandidates = sorted.slice(0, 10).map(c => toRerankCandidate({
        id: c.id,
        name: c.name,
        brandName: c.brandName,
        foodType: c.foodType,
        score: c.score,
        source: c.source,
    }));

    const rerankResult = simpleRerank(searchQuery, rerankCandidates);

    console.log('  Top 5 after scoring:');
    sorted.slice(0, 5).forEach((c, i) => printCandidate(c, i + 1));

    if (rerankResult) {
        printSubHeader('Step 8: Final Selection');
        console.log(`  ✅ Winner: ${rerankResult.winner.name}`);
        console.log(`     Confidence: ${rerankResult.confidence.toFixed(3)}`);
        console.log(`     Reason: ${rerankResult.reason}`);
    }
}

async function debugFromLog(logFile: string, index: number) {
    const logPath = path.resolve(logFile);

    if (!fs.existsSync(logPath)) {
        console.error(`❌ Log file not found: ${logPath}`);
        process.exit(1);
    }

    const logData = JSON.parse(fs.readFileSync(logPath, 'utf-8'));
    const mappings = logData.mappings || [];

    if (index < 0 || index >= mappings.length) {
        console.error(`❌ Index ${index} out of range. Log has ${mappings.length} entries (0-${mappings.length - 1})`);
        process.exit(1);
    }

    const entry = mappings[index];
    console.log(`\nLoading entry ${index} from log: "${entry.rawIngredient}"`);

    // Show what the log recorded
    printHeader(`LOG ENTRY: "${entry.rawIngredient}"`);
    console.log(`  Final Result: ${entry.finalResult}`);
    if (entry.failureReason) {
        console.log(`  Failure Reason: ${entry.failureReason}`);
    }
    if (entry.selectedCandidate) {
        console.log(`  Selected: ${entry.selectedCandidate.foodName} (conf: ${entry.selectedCandidate.confidence})`);
    }
    console.log('\n  Original Top Candidates from Log:');
    entry.topCandidates?.forEach((c: any) => {
        const brand = c.brandName ? ` (${c.brandName})` : '';
        console.log(`    ${c.rank}. [${c.source}] ${c.foodName}${brand} - score: ${c.score}`);
    });

    // Now re-run the debug
    console.log('\n\n📍 RE-RUNNING DEBUG TO SEE CURRENT BEHAVIOR:\n');
    await debugIngredient(entry.rawIngredient);
}

// ============================================================
// Main
// ============================================================

async function main() {
    const args = parseArgs();

    if (!args.ingredient && !args.search && !args.fromLog) {
        console.log('❌ No input provided. Use --ingredient, --search, or --from-log');
        printUsage();
        process.exit(1);
    }

    try {
        if (args.fromLog) {
            await debugFromLog(args.fromLog, args.index ?? 0);
        } else if (args.ingredient) {
            await debugIngredient(args.ingredient);
        } else if (args.search) {
            printHeader(`SEARCH-ONLY DEBUG: "${args.search}"`);
            await debugSearchQuery(args.search);
        }
    } catch (err) {
        console.error('\n❌ Error:', (err as Error).message);
        console.error((err as Error).stack);
        process.exit(1);
    }

    console.log('\n✅ Debug complete\n');
    process.exit(0);
}

main();
