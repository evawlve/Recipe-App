#!/usr/bin/env npx ts-node
/**
 * Detailed Mapping Pipeline Debug Script
 * 
 * Usage:
 *   npx tsx scripts/debug-mapping-pipeline.ts "1 cup chopped onion"
 *   npx tsx scripts/debug-mapping-pipeline.ts --ingredient "3 medium scallions"
 * 
 * DEFAULT MODE: Runs mapIngredientWithFallback (same as pilot import).
 * 
 * Options:
 *   --skip-cache     Skip cache lookups (force fresh search)
 *   --skip-fdc       Skip FDC (USDA) API
 *   --verbose        Show even more details
 *   --debug-steps    Run step-by-step pipeline (parse → normalize → gather → filter → rerank)
 *                    NOTE: This mode does NOT run serving selection or hydration!
 *   --with-cleanup   Apply database cleanup patterns before mapping (like pilot import)
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { gatherCandidates, confidenceGate, type UnifiedCandidate, type GatherOptions } from '../src/lib/fatsecret/gather-candidates';
import { filterCandidatesByTokens, isDietaryConstraintViolation, isCategoryMismatch } from '../src/lib/fatsecret/filter-candidates';
import { simpleRerank, toRerankCandidate } from '../src/lib/fatsecret/simple-rerank';
import { aiSimplifyIngredient } from '../src/lib/fatsecret/ai-simplify';
import { getValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { applyCleanupPatterns } from '../src/lib/ingredients/cleanup';
import chalk from 'chalk';

// ============================================================
// CLI Argument Parsing
// ============================================================

const args = process.argv.slice(2);
let ingredient = '';
let skipCache = false;
let skipFdc = false;
let verbose = false;
let debugStepsMode = false;
let withCleanup = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ingredient' && args[i + 1]) {
        ingredient = args[i + 1];
        i++;
    } else if (args[i] === '--skip-cache') {
        skipCache = true;
    } else if (args[i] === '--skip-fdc') {
        skipFdc = true;
    } else if (args[i] === '--verbose') {
        verbose = true;
    } else if (args[i] === '--debug-steps') {
        debugStepsMode = true;
    } else if (args[i] === '--production') {
        // Legacy alias — production is now the default, so this is a no-op
        // Keep for backward compatibility
    } else if (args[i] === '--with-cleanup') {
        withCleanup = true;
    } else if (!args[i].startsWith('--')) {
        ingredient = args[i];
    }
}

if (!ingredient) {
    console.log(chalk.red('Usage: debug-mapping-pipeline.ts "ingredient line"'));
    console.log(chalk.gray('  Options: --skip-cache, --skip-fdc, --verbose, --debug-steps, --with-cleanup'));
    console.log(chalk.gray('  Default: runs mapIngredientWithFallback (same as pilot import)'));
    console.log(chalk.gray('  --debug-steps: step-by-step pipeline (NO serving selection or hydration)'));
    process.exit(1);
}

// ============================================================
// Formatting Helpers
// ============================================================

const divider = chalk.gray('═'.repeat(70));
const subDivider = chalk.gray('─'.repeat(50));

function header(step: number, title: string) {
    console.log();
    console.log(divider);
    console.log(chalk.bold.cyan(`  STEP ${step}: ${title}`));
    console.log(divider);
}

function success(msg: string) {
    console.log(chalk.green(`  ✓ ${msg}`));
}

function warning(msg: string) {
    console.log(chalk.yellow(`  ⚠ ${msg}`));
}

function error(msg: string) {
    console.log(chalk.red(`  ✗ ${msg}`));
}

function info(label: string, value: string | number | null | undefined) {
    console.log(chalk.gray(`  ${label}: `) + chalk.white(value ?? '(none)'));
}

function candidateTable(candidates: UnifiedCandidate[], limit = 10) {
    console.log();
    console.log(chalk.gray('  Rank | Score  | Source    | Name'));
    console.log(chalk.gray('  ' + '─'.repeat(60)));

    candidates.slice(0, limit).forEach((c, i) => {
        const source = c.source.padEnd(9);
        const score = c.score.toFixed(3).padStart(6);
        const name = c.name.slice(0, 40);
        const brand = c.brandName ? chalk.gray(` (${c.brandName.slice(0, 15)})`) : '';
        console.log(`  ${String(i + 1).padStart(4)} | ${score} | ${source} | ${name}${brand}`);
    });

    if (candidates.length > limit) {
        console.log(chalk.gray(`  ... and ${candidates.length - limit} more`));
    }
}

// ============================================================
// Production Mode - Call mapIngredientWithFallback directly
// ============================================================
// This matches EXACTLY what pilot-batch-import does

async function runProductionMode(rawLine: string) {
    console.log();
    console.log(chalk.bold.yellow('╔══════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.yellow('║  PRODUCTION MODE - Calling mapIngredientWithFallback'));
    console.log(chalk.bold.yellow('╚══════════════════════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.white(`  Input: "${rawLine}"`));
    console.log(chalk.gray(`  Skip Cache: ${skipCache}, With Cleanup: ${withCleanup}`));
    console.log();

    let effectiveLine = rawLine;

    // Apply cleanup patterns if requested (like pilot-batch-import does)
    if (withCleanup) {
        console.log(chalk.cyan('  Step 0: Applying cleanup patterns...'));
        const cleanupResult = await applyCleanupPatterns(rawLine);
        if (cleanupResult.appliedPatterns.length > 0) {
            console.log(chalk.green(`    ✓ Applied ${cleanupResult.appliedPatterns.length} patterns`));
            for (const p of cleanupResult.appliedPatterns) {
                console.log(chalk.gray(`      - ${p.pattern} (${p.type})`));
            }
            console.log(chalk.white(`    Before: "${rawLine}"`));
            console.log(chalk.white(`    After:  "${cleanupResult.cleaned}"`));
            effectiveLine = cleanupResult.cleaned;
        } else {
            console.log(chalk.gray('    No patterns applied'));
        }
        console.log();
    }

    console.log(chalk.cyan('  Calling mapIngredientWithFallback()...'));
    console.log();

    try {
        const result = await mapIngredientWithFallback(effectiveLine, {
            minConfidence: 0.5,
            skipAiValidation: true,
            skipCache,
            skipFdc,
            debug: true,  // Enable debug logging
        });

        if (!result) {
            console.log(chalk.red('  ✗ Result: NULL (no mapping found)'));
        } else if ('status' in result && result.status === 'pending') {
            console.log(chalk.yellow('  ⏳ Result: PENDING (locked by another process)'));
        } else {
            console.log(chalk.green('  ✓ Result:'));
            console.log(chalk.white(`    Food Name:   ${result.foodName}`));
            console.log(chalk.white(`    Food ID:     ${result.foodId}`));
            console.log(chalk.white(`    Source:      ${result.source}`));
            console.log(chalk.white(`    Confidence:  ${result.confidence.toFixed(3)}`));
            console.log(chalk.white(`    Grams:       ${result.grams}`));
            console.log(chalk.white(`    Calories:    ${result.kcal}`));
            if (result.brandName) {
                console.log(chalk.gray(`    Brand:       ${result.brandName}`));
            }
            if (result.servingDescription) {
                console.log(chalk.gray(`    Serving:     ${result.servingDescription}`));
            }
        }
    } catch (err) {
        console.log(chalk.red(`  ✗ Error: ${(err as Error).message}`));
    }

    console.log();
    console.log(chalk.gray('Done.'));
}

// ============================================================
// Main Debug Pipeline
// ============================================================

async function debugPipeline(rawLine: string) {
    console.log();
    console.log(chalk.bold.magenta('╔══════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.magenta('║  INGREDIENT MAPPING PIPELINE DEBUG'));
    console.log(chalk.bold.magenta('╚══════════════════════════════════════════════════════════════════════╝'));
    console.log();
    console.log(chalk.white(`  Input: "${rawLine}"`));
    console.log(chalk.gray(`  Skip Cache: ${skipCache}, Skip FDC: ${skipFdc}`));

    const client = new FatSecretClient();

    // ─────────────────────────────────────────────────────────────────────
    // STEP 1: PARSE
    // ─────────────────────────────────────────────────────────────────────
    header(1, 'PARSE INGREDIENT LINE');

    const parsed = parseIngredientLine(rawLine);

    if (parsed) {
        success('Parsing successful');
        info('Quantity', parsed.qty);
        info('Multiplier', parsed.multiplier);
        info('Unit', parsed.unit);
        info('Raw Unit', parsed.rawUnit);
        info('Name', parsed.name);
        info('Qualifiers', parsed.qualifiers?.join(', '));
        info('Notes', parsed.notes);
        info('Unit Hint', parsed.unitHint);
    } else {
        error('Parsing failed - using raw line as name');
    }

    const baseName = parsed?.name?.trim() || rawLine;

    // ─────────────────────────────────────────────────────────────────────
    // STEP 2: NORMALIZE
    // ─────────────────────────────────────────────────────────────────────
    header(2, 'NORMALIZE NAME');

    const normalized = normalizeIngredientName(baseName);

    info('Input', baseName);
    info('Cleaned', normalized.cleaned);
    info('Modifications', normalized.modifications?.join(', '));

    const normalizedName = normalized.cleaned || baseName;

    // ─────────────────────────────────────────────────────────────────────
    // STEP 3: CHECK CACHE
    // ─────────────────────────────────────────────────────────────────────
    header(3, 'CHECK CACHE');

    if (skipCache) {
        warning('Cache check skipped (--skip-cache)');
    } else {
        const cached = await getValidatedMapping(normalizedName);
        if (cached) {
            success(`Cache hit: ${cached.foodName}`);
            info('Food ID', cached.foodId);
            info('Confidence', cached.confidence);
            console.log();
            console.log(chalk.yellow('  → Would return cached result (skipping for debug)'));
        } else {
            info('Status', 'No cache hit');
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 4: GATHER CANDIDATES
    // ─────────────────────────────────────────────────────────────────────
    header(4, 'GATHER CANDIDATES');

    const gatherOptions: GatherOptions = {
        client,
        skipCache,  // Respect CLI flag (was hardcoded to true — Bug 1 fix)
        skipLiveApi: false,
        skipFdc,
        aiSynonyms: [],
    };

    console.log(chalk.gray('  Querying FatSecret API...'));
    console.log(chalk.gray('  Querying FDC (USDA) API...'));

    const allCandidates = await gatherCandidates(rawLine, parsed, normalizedName, gatherOptions);

    success(`Found ${allCandidates.length} candidates`);

    // Show by source
    const bySource = {
        fatsecret: allCandidates.filter(c => c.source === 'fatsecret').length,
        fdc: allCandidates.filter(c => c.source === 'fdc').length,
        cache: allCandidates.filter(c => c.source === 'cache').length,
    };
    info('FatSecret', bySource.fatsecret);
    info('FDC (USDA)', bySource.fdc);
    info('Cache', bySource.cache);

    if (verbose) {
        console.log();
        console.log(chalk.gray('  All candidates (pre-filter):'));
        candidateTable(allCandidates, 20);
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 5: FILTER CANDIDATES
    // ─────────────────────────────────────────────────────────────────────
    header(5, 'FILTER CANDIDATES');

    const filterResult = filterCandidatesByTokens(allCandidates, normalizedName, {
        debug: true,
        rawLine
    });
    const filtered = filterResult.filtered;
    const removedCount = filterResult.removedCount;

    info('Kept', filtered.length);
    info('Removed', removedCount);

    // Show removed candidates with reasons
    if (removedCount > 0 && verbose) {
        console.log();
        console.log(chalk.gray('  Removed candidates (sample):'));
        const removed = allCandidates.filter(c => !filtered.includes(c)).slice(0, 5);
        for (const c of removed) {
            let reason = 'token_mismatch';
            if (isDietaryConstraintViolation(rawLine, c.name, c.brandName)) {
                reason = 'dietary_constraint';
            } else if (isCategoryMismatch(normalizedName, c.name, c.brandName)) {
                reason = 'category_mismatch';
            }
            console.log(chalk.red(`    ✗ ${c.name} [${reason}]`));
        }
    }

    console.log();
    console.log(chalk.gray('  Surviving candidates:'));
    candidateTable(filtered, 10);

    if (filtered.length === 0) {
        error('No candidates survived filtering!');
        console.log(chalk.yellow('  → Will proceed to AI fallback'));
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 6: CONFIDENCE GATE
    // ─────────────────────────────────────────────────────────────────────
    header(6, 'CONFIDENCE GATE');

    if (filtered.length > 0) {
        const gateResult = confidenceGate(parsed?.name || normalizedName, filtered);

        info('Skip AI Rerank', gateResult.skipAiRerank);
        info('Confidence', gateResult.confidence.toFixed(3));
        info('Reason', gateResult.reason);

        if (gateResult.skipAiRerank && gateResult.selected) {
            success(`High confidence match: ${gateResult.selected.name}`);
        }
    } else {
        warning('Skipped (no candidates)');
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 7: SIMPLE RERANK
    // ─────────────────────────────────────────────────────────────────────
    header(7, 'SIMPLE RERANK (Scoring)');

    if (filtered.length > 0) {
        const rerankCandidates = filtered.slice(0, 10).map(c => toRerankCandidate({
            id: c.id,
            name: c.name,
            brandName: c.brandName,
            foodType: c.foodType,
            score: c.score,
            source: c.source,
            nutrition: c.nutrition,
        }));

        const rerankResult = simpleRerank(
            parsed?.name || normalizedName,
            rerankCandidates,
            undefined,  // No AI nutrition estimate for debug
            rawLine
        );

        if (rerankResult && rerankResult.winner) {
            success(`Winner: ${rerankResult.winner.name}`);
            info('Confidence', rerankResult.confidence.toFixed(3));
            info('Reason', rerankResult.reason);

            // Check threshold
            const MIN_CONFIDENCE = 0.80;
            if (rerankResult.confidence < MIN_CONFIDENCE) {
                warning(`Below threshold (${MIN_CONFIDENCE}) - would be rejected`);
            }
        } else {
            warning('simpleRerank returned null (no winner or below threshold)');
        }
    } else {
        warning('Skipped (no candidates)');
    }

    // ─────────────────────────────────────────────────────────────────────
    // STEP 8: AI SIMPLIFICATION FALLBACK
    // ─────────────────────────────────────────────────────────────────────
    header(8, 'AI SIMPLIFICATION FALLBACK');

    console.log(chalk.gray('  Calling aiSimplifyIngredient...'));

    try {
        const simplifyResult = await aiSimplifyIngredient(rawLine);

        if (simplifyResult && simplifyResult.simplified) {
            success(`AI simplified to: "${simplifyResult.simplified}"`);
            info('Rationale', simplifyResult.rationale);
            info('Original', rawLine);
            info('Simplified', simplifyResult.simplified);

            if (simplifyResult.simplified !== normalizedName) {
                console.log();
                console.log(chalk.cyan('  → Would re-run pipeline with simplified query'));
            } else {
                warning('Simplified same as original - no improvement');
            }
        } else {
            warning('AI simplification returned null or no change');
        }
    } catch (err) {
        error(`AI simplification failed: ${(err as Error).message}`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────────────
    console.log();
    console.log(chalk.bold.magenta('╔══════════════════════════════════════════════════════════════════════╗'));
    console.log(chalk.bold.magenta('║  PIPELINE SUMMARY'));
    console.log(chalk.bold.magenta('╚══════════════════════════════════════════════════════════════════════╝'));
    console.log();

    console.log(chalk.gray('  Step 1 (Parse):     ') + (parsed ? chalk.green('✓') : chalk.red('✗')));
    console.log(chalk.gray('  Step 2 (Normalize): ') + chalk.green('✓'));
    console.log(chalk.gray('  Step 3 (Cache):     ') + (skipCache ? chalk.yellow('⊘ skipped') : chalk.gray('checked')));
    console.log(chalk.gray('  Step 4 (Gather):    ') + chalk.white(`${allCandidates.length} candidates`));
    console.log(chalk.gray('  Step 5 (Filter):    ') + chalk.white(`${filtered.length} survived`));
    console.log(chalk.gray('  Step 6 (Gate):      ') + (filtered.length > 0 ? chalk.green('✓') : chalk.yellow('⊘')));
    console.log(chalk.gray('  Step 7 (Rerank):    ') + (filtered.length > 0 ? chalk.green('✓') : chalk.yellow('⊘')));
    console.log(chalk.gray('  Step 8 (Fallback):  ') + chalk.green('✓'));

    console.log();
    console.log(chalk.gray('Done.'));
}

// Run
if (debugStepsMode) {
    console.log(chalk.yellow('  ⚠ --debug-steps mode: NO serving selection or hydration. Use default mode for accurate results.'));
    debugPipeline(ingredient).catch(console.error);
} else {
    runProductionMode(ingredient).catch(console.error);
}
