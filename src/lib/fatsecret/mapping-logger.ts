import fs from 'fs';
import path from 'path';

export interface MappingAnalysisLog {
    timestamp: string;
    rawIngredient: string;
    parsed: {
        amount?: number;
        unit?: string;
        ingredient?: string;
    };

    // Candidate analysis
    topCandidates: Array<{
        rank: number;
        foodId: string;
        foodName: string;
        brandName?: string | null;
        score: number;
        source: string;
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

    fs.writeFileSync(logFilePath, JSON.stringify(output, null, 2), 'utf-8');
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

    // Flag suspicious mappings for easy spotting
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

    // Format the line
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    const line = `${status} [${conf}] "${raw}" → "${mapped}${brand}"${nutritionStr}${flagStr}\n`;

    fs.appendFileSync(simpleSummaryPath, line, 'utf-8');
}

/**
 * Finalize the mapping analysis session
 */
export function finalizeMappingAnalysisSession() {
    if (!currentSession || !logFilePath) return;

    writeSessionToFile();

    console.log('\n' + '='.repeat(80));
    console.log('📊 MAPPING ANALYSIS SESSION COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total Ingredients: ${currentSession.mappings.length}`);
    console.log(`Successful: ${currentSession.mappings.filter(m => m.finalResult === 'success').length}`);
    console.log(`Failed: ${currentSession.mappings.filter(m => m.finalResult === 'failed').length}`);
    console.log(`Detailed log: ${logFilePath}`);
    console.log(`Quick summary: ${simpleSummaryPath}\n`);

    currentSession = null;
    logFilePath = null;
    simpleSummaryPath = null;
}
