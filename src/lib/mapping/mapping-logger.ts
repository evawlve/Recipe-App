import fs from 'fs';
import path from 'path';
import { getAiCallMetrics, getAiCallSummary, resetAiCallMetrics } from '../ai/structured-client';
import type { RerankOutcome, RerankScoredCandidate } from './simple-rerank';

export interface MappingAnalysisLog {
    timestamp?: string;  // Optional - can be generated automatically if not provided
    rawIngredient: string;
    parsed: {
        amount?: number;
        unit?: string | null;
        ingredient?: string | null;
    };

    // Candidate analysis
    topCandidates: Array<{
        rank: number;
        foodId: string;
        foodName: string;
        brandName?: string | null;
        score: number;
        source: string;
        /** Present iff the candidate was reached by semantic search. `laneMode()` in
         *  `rerank-pool.ts` keys the lane split on PRESENCE, not magnitude, so an
         *  offline replay of `buildRerankPool()` cannot reconstruct the lanes without
         *  it — that is why an otherwise-complete log validated at only 82.1%. Null
         *  means keyword-reached; absent means the record predates this field. */
        semanticSimilarity?: number | null;
        serving?: {
            description?: string | null;
            grams?: number | null;
            metricAmount?: number | null;
            metricUnit?: string | null;
        };
        nutrition?: {
            calories: number;
            protein: number;
            fat: number;
            carbs: number;
        };
    }>;

    /* LOG-ONLY (2026-09-11, Lane A S47). What simpleRerank() RETURNED for this
     * line, and every score it computed.
     *
     * THE THREE FIELDS ARE REQUIRED, NOT OPTIONAL, AND THAT IS DELIBERATE. An
     * earlier cut of this change made them optional; six of the nine
     * `logMappingAnalysis()` seats then silently omitted them, and an omitted key
     * and a pre-instrument entry are BYTE-IDENTICAL after `JSON.stringify`. A
     * census could not tell "this build, the reranker did not run" from "this
     * build predates the field" on 46.7% of the corpus. Requiring them makes the
     * compiler name every seat, which is the only forcing function that works
     * here — no test can see a field a writer forgot.
     *
     * So the reading is exact:
     *   key ABSENT  -> the entry predates this instrument. The box ledger owns
     *                  which build introduced it. Treat as UNKNOWN.
     *   value null  -> this build, and the reranker did not run for this line
     *                  (a cache hit, or no pool).
     *   `scoredCount: 0` inside a non-null outcome -> the reranker RAN and
     *                  short-circuited on a single candidate. A different thing.
     *
     * `rerankPool` is NOT `topCandidates` with extra columns and the two must
     * never be joined positionally. `topCandidates` is
     * `filtered.slice(0, MAPPING_ANALYSIS_TOP_N)` — a depth-capped prefix of
     * `filtered`, which is in GATHER order, not score order (`rerank-pool.ts`'s
     * header is the owner of that fact and states it three times; the caller
     * keeps a separate `sortedFiltered` precisely because `filtered` is not
     * sorted). `rerankPool` is the pool `buildRerankPool()`'s source×mode
     * round-robin handed the reranker, in FINAL RANK order after
     * `scored.sort()`. Join them by `foodId` or not at all — `foodId` is unique
     * in the pool only because `gatherCandidates()` dedupes through a `byId` map
     * upstream; `simpleRerank()` itself does not dedupe, and the Fix-50 dedupe
     * keys on NAME. That guarantee lives two modules away, so a census that
     * groups by `foodId` is relying on it.
     *
     * AND `rerankOutcome.winner` NEED NOT BE `selectedCandidate.foodId`. The
     * serving-failure fallback can substitute a lower-ranked candidate after the
     * rerank, and nothing marks that — `rerankStage` only distinguishes the two
     * rerank CALLS. Reading a mismatch as "the gate refused" mis-classifies every
     * serving-failure fallback; the refusal test is
     * `rerankOutcome.winner === null && rerankOutcome.winnerId !== null`. */
    rerankOutcome: RerankOutcome | null;
    rerankPool: RerankScoredCandidate[] | null;
    /** Which reranker produced `rerankOutcome`. `cache_failure_research` is the
     *  second call, over a freshly-searched pool, on the
     *  `normalized_cache_hit` + serving-failure path. Null iff `rerankOutcome`
     *  is null. */
    rerankStage: 'primary' | 'cache_failure_research' | null;

    // Selection decision
    selectedCandidate: {
        foodId: string;
        foodName: string;
        brandName?: string | null;
        confidence: number;
        selectionReason: string;
    };

    // Nutrition for false positive detection
    selectedNutrition?: {
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        perGrams: number;
    };

    // Serving selection
    servingSelection?: {
        servingDescription?: string | null;
        grams: number;
        backfillUsed: boolean;
        backfillType?: 'volume' | 'weight';
    };

    // AI validation
    aiValidation?: {
        approved: boolean;
        confidence: number;
        category?: string;
        reason: string;
        detectedIssues: string[];
    };

    // Final result
    finalResult: 'success' | 'failed' | 'skipped';
    failureReason?: string;

    // Source tracking - where did this mapping come from?
    source?: 'early_cache' | 'normalized_cache' | 'full_pipeline';

    // AI call tracking - which AI calls were made for this ingredient
    aiCalls?: {
        normalize?: { called: boolean; skipped: boolean; reason?: string; };
        serving?: { called: boolean; type?: 'ambiguous' | 'produce' | 'weight'; };
        nutrition?: { called: boolean; cached: boolean; success: boolean; };
    };
}

interface MappingAnalysisSession {
    sessionId: string;
    startTime: string;
    mappings: MappingAnalysisLog[];
}

let currentSession: MappingAnalysisSession | null = null;
let logFilePath: string | null = null;
let simpleSummaryPath: string | null = null;

/**
 * Initialize a new mapping analysis session
 */
export function initMappingAnalysisSession() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const logsDir = path.join(process.cwd(), 'logs');

    try {
        // Ensure logs directory exists
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        logFilePath = path.join(logsDir, `mapping-analysis-${timestamp}.json`);
        simpleSummaryPath = path.join(logsDir, `mapping-summary-${timestamp}.txt`);

        currentSession = {
            sessionId: `session-${timestamp}`,
            startTime: new Date().toISOString(),
            mappings: [],
        };

        // Initialize simple summary file with header
        const header = [
            '# Mapping Summary - Quick Review',
            `# Generated: ${new Date().toISOString()}`,
            '# Format: [CONF] "Raw Ingredient" → "Mapped Food"',
            '#',
            '# Look for:',
            '#   - Mismatched modifiers (lowfat query → whole food)',
            '#   - Complex products (simple ingredient → multi-ingredient product)',
            '#   - Category mismatches (zest → cake, extract → cookie)',
            '#',
            '',
        ].join('\n');
        fs.writeFileSync(simpleSummaryPath, header, 'utf-8');
        
        console.log(`\n📊 Mapping Analysis Session Started`);
        console.log(`   Detailed log: ${logFilePath}`);
        console.log(`   Quick summary: ${simpleSummaryPath}\n`);
    } catch (e) {
        console.warn('[mapping-logger] Failed to initialize file session:', e);
        logFilePath = null;
        simpleSummaryPath = null;
        
        currentSession = {
            sessionId: `session-${timestamp}`,
            startTime: new Date().toISOString(),
            mappings: [],
        };
        console.log(`\n📊 Mapping Analysis Session Started (In-Memory Only due to filesystem error)`);
    }
}

/**
 * Log a mapping analysis entry
 */
export function logMappingAnalysis(log: MappingAnalysisLog) {
    if (!currentSession) {
        initMappingAnalysisSession();
    }

    // Add to session
    currentSession!.mappings.push(log);

    // Console output with formatting
    console.log('\n' + '='.repeat(80));
    console.log(`📊 MAPPING: ${log.rawIngredient}`);
    console.log('='.repeat(80));

    // Parsed info
    if (log.parsed.amount || log.parsed.unit) {
        console.log(`📝 Parsed: ${log.parsed.amount || ''} ${log.parsed.unit || ''} ${log.parsed.ingredient || ''}`);
    }

    // Top candidates with nutrition
    console.log('\n🏆 Top Candidates:');
    log.topCandidates.forEach(c => {
        const brand = c.brandName ? ` (${c.brandName})` : '';
        const serving = c.serving ? ` (${c.serving.description ?? 'serving'}${c.serving.grams ? `, ${c.serving.grams}g` : ''}${c.serving.metricAmount ? `, ${c.serving.metricAmount}${c.serving.metricUnit ?? ''}` : ''})` : '';
        const nutrition = c.nutrition ? ` [${c.nutrition.calories}kcal, ${c.nutrition.protein}p/${c.nutrition.carbs}c/${c.nutrition.fat}f]` : '';
        console.log(`  ${c.rank}. [${c.score.toFixed(3)}] ${c.foodName}${brand} [${c.source}]${serving}${nutrition}`);
    });

    // Selection
    const selectedBrand = log.selectedCandidate.brandName ? ` (${log.selectedCandidate.brandName})` : '';
    console.log(`\n✓ Selected: ${log.selectedCandidate.foodName}${selectedBrand}`);
    console.log(`  Confidence: ${log.selectedCandidate.confidence.toFixed(3)}`);
    console.log(`  Reason: ${log.selectedCandidate.selectionReason}`);

    // Show nutrition for false positive detection
    if (log.selectedNutrition) {
        const n = log.selectedNutrition;
        console.log(`  📊 Macros (per ${n.perGrams}g): ${n.calories}kcal | P:${n.protein}g C:${n.carbs}g F:${n.fat}g`);
    }

    // Serving
    if (log.servingSelection) {
        console.log(`\n📏 Serving: ${log.servingSelection.servingDescription || 'N/A'} (${log.servingSelection.grams}g)`);
        if (log.servingSelection.backfillUsed) {
            console.log(`  ⚡ Backfilled: ${log.servingSelection.backfillType}`);
        }
    }

    // AI validation
    if (log.aiValidation) {
        const icon = log.aiValidation.approved ? '✅' : '❌';
        console.log(`\n🤖 AI Validation: ${icon}`);
        console.log(`  Confidence: ${log.aiValidation.confidence}`);
        console.log(`  Category: ${log.aiValidation.category || 'N/A'}`);
        console.log(`  Reason: ${log.aiValidation.reason}`);
        if (log.aiValidation.detectedIssues?.length) {
            console.log(`  Issues: ${log.aiValidation.detectedIssues.join(', ')}`);
        }
    }

    // Final result
    const resultIcon = log.finalResult === 'success' ? '✅' : log.finalResult === 'failed' ? '❌' : '⏭️';
    console.log(`\n${resultIcon} Result: ${log.finalResult.toUpperCase()}`);
    if (log.failureReason) {
        console.log(`  Reason: ${log.failureReason}`);
    }

    // Write to files
    writeSessionToFile();
    writeSimpleSummaryEntry(log);
}

/**
 * Write the current session to the JSON file
 */
function writeSessionToFile() {
    if (!currentSession || !logFilePath) return;

    // Calculate summary stats
    const total = currentSession.mappings.length;
    const successful = currentSession.mappings.filter(m => m.finalResult === 'success').length;
    const failed = currentSession.mappings.filter(m => m.finalResult === 'failed').length;
    const aiApproved = currentSession.mappings.filter(m => m.aiValidation?.approved).length;
    const avgConfidence = currentSession.mappings.reduce((sum, m) => sum + m.selectedCandidate.confidence, 0) / total || 0;

    const output = {
        ...currentSession,
        summary: {
            totalIngredients: total,
            successfulMappings: successful,
            failedMappings: failed,
            aiApprovalRate: total > 0 ? aiApproved / total : 0,
            avgConfidence,
        },
    };

    try {
        fs.writeFileSync(logFilePath, JSON.stringify(output, null, 2), 'utf-8');
    } catch (e) {
        console.warn('[mapping-logger] Failed to write session to file:', e);
    }
}

/**
 * Write a simple one-line summary entry for easy scanning
 */
function writeSimpleSummaryEntry(log: MappingAnalysisLog) {
    if (!simpleSummaryPath) return;

    const conf = log.selectedCandidate.confidence.toFixed(2);
    const raw = log.rawIngredient;
    const mapped = log.selectedCandidate.foodName;
    const brand = log.selectedCandidate.brandName ? ` (${log.selectedCandidate.brandName})` : '';
    const status = log.finalResult === 'success' ? '✓' : log.finalResult === 'failed' ? '✗' : '⏭';

    // Flag suspicious/notable mappings for easy spotting
    const flags: string[] = [];

    // Check for potential issues
    const rawLower = raw.toLowerCase();
    const mappedLower = mapped.toLowerCase();

    // Long mapped name might indicate complex product
    if (mapped.split(' ').length > 5) {
        flags.push('COMPLEX_PRODUCT');
    }

    // Check for potential modifier mismatches
    const fatModifiers = ['lowfat', 'low fat', 'nonfat', 'skim', 'reduced fat', 'fat free'];
    const queryHasFatMod = fatModifiers.some(m => rawLower.includes(m));
    const foodHasFatMod = fatModifiers.some(m => mappedLower.includes(m));
    if (queryHasFatMod && !foodHasFatMod) {
        flags.push('MISSING_FAT_MOD');
    }
    if (!queryHasFatMod && foodHasFatMod) {
        flags.push('UNWANTED_FAT_MOD');
    }

    // Low confidence
    if (log.selectedCandidate.confidence < 0.7) {
        flags.push('LOW_CONF');
    }

    // AI-generated nutrition (not from FatSecret/FDC)
    if (log.selectedCandidate.selectionReason?.includes('ai_nutrition')) {
        flags.push('AI_GENERATED');
    }

    // Build nutrition summary with BOTH per-serving AND calculated totals
    const nutr = log.selectedNutrition;
    const serving = log.servingSelection;
    const parsed = log.parsed;
    let nutritionStr = '';

    if (nutr && serving) {
        // Show per-serving first (the database values)
        const perServingStr = `${nutr.calories.toFixed(0)}kcal/${nutr.perGrams}g`;

        // Calculate total based on parsed quantity (if available)
        // The nutr values are ALREADY for the selected serving (perGrams)
        // So we just show them as the calculated total
        const totalKcal = nutr.calories;
        const totalStr = `= ${totalKcal.toFixed(0)}kcal P:${nutr.protein.toFixed(1)} C:${nutr.carbs.toFixed(1)} F:${nutr.fat.toFixed(1)}`;

        nutritionStr = ` | (${perServingStr}) ${totalStr}`;

        // Flag suspiciously high calories (> 500 for a single ingredient)
        if (totalKcal > 500) {
            flags.push('HIGH_KCAL');
        }

        // Flag suspiciously high per-100g calories (> 400 for most whole foods)
        const kcalPer100g = (nutr.calories / nutr.perGrams) * 100;
        if (kcalPer100g > 400 && !mappedLower.includes('oil') && !mappedLower.includes('butter') && !mappedLower.includes('nut')) {
            flags.push('KCAL_CHECK');
        }
    } else if (nutr) {
        // Fallback if no serving info
        nutritionStr = ` | ${nutr.calories.toFixed(0)}kcal P:${nutr.protein.toFixed(1)} C:${nutr.carbs.toFixed(1)} F:${nutr.fat.toFixed(1)}`;
    }

    // Format the line with source indicator and AI call indicator
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    const sourceTag = log.source ? `{${log.source}} ` : '';

    // AI call indicator
    let aiTag = '';
    if (log.aiCalls) {
        const parts: string[] = [];
        if (log.aiCalls.normalize?.called) parts.push('NORM');
        if (log.aiCalls.normalize?.skipped) parts.push('GATE');
        if (log.aiCalls.serving?.called) parts.push('SERV');
        if (log.aiCalls.nutrition?.called) parts.push(log.aiCalls.nutrition.cached ? 'NUTR:CACHE' : 'NUTR');
        if (parts.length > 0) {
            aiTag = ` [AI:${parts.join('+')}]`;
        }
    } else if (log.source === 'early_cache' || log.source === 'normalized_cache') {
        aiTag = ' [AI:CACHE]';
    }

    const line = `${status} ${sourceTag}[${conf}] "${raw}" → "${mapped}${brand}"${nutritionStr}${aiTag}${flagStr}\n`;

    try {
        fs.appendFileSync(simpleSummaryPath, line, 'utf-8');
    } catch (e) {
        console.warn('[mapping-logger] Failed to append simple summary entry:', e);
    }
}

/**
 * Finalize the mapping analysis session
 */
export function finalizeMappingAnalysisSession() {
    if (!currentSession || !logFilePath) return;

    writeSessionToFile();

    // Get AI call metrics
    const metrics = getAiCallMetrics();
    const aiSummary = getAiCallSummary();

    console.log('\n' + '='.repeat(80));
    console.log('📊 MAPPING ANALYSIS SESSION COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total Ingredients: ${currentSession.mappings.length}`);
    console.log(`Successful: ${currentSession.mappings.filter(m => m.finalResult === 'success').length}`);
    console.log(`Failed: ${currentSession.mappings.filter(m => m.finalResult === 'failed').length}`);
    console.log('');
    console.log('🤖 ' + aiSummary.replace(/\n/g, '\n   '));
    console.log('');
    console.log(`Detailed log: ${logFilePath}`);
    console.log(`Quick summary: ${simpleSummaryPath}\n`);

    // Write AI summary to the simple summary file
    if (simpleSummaryPath) {
        try {
            fs.appendFileSync(simpleSummaryPath, '\n' + '='.repeat(50) + '\n', 'utf-8');
            fs.appendFileSync(simpleSummaryPath, aiSummary + '\n', 'utf-8');
        } catch (e) {
            console.warn('[mapping-logger] Failed to finalize simple summary file:', e);
        }
    }

    // Reset metrics for next session
    resetAiCallMetrics();

    currentSession = null;
    logFilePath = null;
    simpleSummaryPath = null;
}
