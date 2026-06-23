import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { gatherCandidates, type UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';
import {
    filterCandidatesByTokens,
    hasCriticalModifierMismatch,
    isCategoryMismatch,
    isMultiIngredientMismatch,
    isReplacementMismatch,
    hasCoreTokenMismatch,
    hasNullOrInvalidMacros,
    hasSuspiciousMacros,
    deriveMustHaveTokens,
} from '../src/lib/fatsecret/filter-candidates';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

// One representative from each failing category
const INGREDIENTS_TO_TEST = [
    // Oils
    '0.5 cup vegetable oil',
    '2 tbsp canola oil',
    '1 tbsp dark sesame oil',
    '1 tbsp oil',
    '2 tbsp organic extra virgin coconut oil',
    // Spices
    '1 tsp cayenne pepper',
    '1 tsp dijon mustard',
    // Butter
    '2 oz salted butter',
    '0.5 oz light butter 1 tbsp',
    '4  sprays butter cooking spray',
    // Produce
    '1 cup petite tomatoes',
    '1.75 cup tomatoes with green chilies',
    // Sweeteners
    '0.5 cup no calorie sweetener',
    '1 serving 1 packet splenda',
    // Water
    '2 cup water - 1 to 2 cups',
];

// Helper to check isWrongFormForContext (not exported, check via name)
async function diagnoseIngredient(rawLine: string) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  DIAGNOSING: "${rawLine}"`);
    console.log(`${'='.repeat(60)}`);

    const parsed = parseIngredientLine(rawLine);
    const baseName = parsed?.name?.trim() || rawLine.trim();
    const normalized = normalizeIngredientName(baseName).cleaned || baseName;

    console.log(`  parsed name:    "${baseName}"`);
    console.log(`  normalized:     "${normalized}"`);

    const mustHaveTokens = deriveMustHaveTokens(normalized);
    console.log(`  mustHaveTokens: [${mustHaveTokens.join(', ')}]`);

    // Gather candidates
    const client = new FatSecretClient();
    let candidates: UnifiedCandidate[];
    try {
        candidates = await gatherCandidates(rawLine, parsed, normalized, {
            client,
            skipCache: true,
        });
    } catch (err) {
        console.log(`  ❌ gatherCandidates ERROR: ${(err as Error).message}`);
        return;
    }

    console.log(`\n  Gathered ${candidates.length} candidates:`);
    if (candidates.length === 0) {
        console.log(`  ❌ NO CANDIDATES GATHERED — APIs returned nothing`);
        return;
    }

    for (const c of candidates.slice(0, 8)) {
        const nutrientsToCheck = extractNutrients(c);
        const kcalStr = nutrientsToCheck ? `${nutrientsToCheck.calories ?? '?'}kcal` : 'no-data';
        console.log(`    [${c.source}] "${c.name}" (score: ${c.score?.toFixed(3) ?? '?'}, ${kcalStr})`);
    }
    if (candidates.length > 8) console.log(`    ... and ${candidates.length - 8} more`);

    // Trace each filter for each candidate
    console.log(`\n  --- Filter Trace (first 8 candidates) ---`);
    for (const candidate of candidates.slice(0, 8)) {
        const reasons: string[] = [];
        const nutrientsToCheck = extractNutrients(candidate);

        // 1. Critical modifier mismatch
        if (hasCriticalModifierMismatch(rawLine, candidate.name, candidate.source)) {
            reasons.push('CRITICAL_MODIFIER_MISMATCH');
        }
        // 2. Replacement mismatch
        if (isReplacementMismatch(rawLine, candidate.name, candidate.brandName)) {
            reasons.push('REPLACEMENT_MISMATCH');
        }
        // 3. Category mismatch
        if (isCategoryMismatch(normalized, candidate.name, candidate.brandName)) {
            reasons.push('CATEGORY_MISMATCH');
        }
        // 4. Multi-ingredient mismatch
        if (isMultiIngredientMismatch(normalized, candidate.name)) {
            reasons.push('MULTI_INGREDIENT_MISMATCH');
        }
        // 5. Null/invalid macros
        if (nutrientsToCheck && hasNullOrInvalidMacros(nutrientsToCheck, candidate.name)) {
            reasons.push('NULL_OR_INVALID_MACROS');
        }
        // 6. Suspicious macros
        if (nutrientsToCheck && hasSuspiciousMacros(rawLine, nutrientsToCheck)) {
            reasons.push('SUSPICIOUS_MACROS');
        }
        // 7. Must-have token check
        const candidateName = [candidate.name, candidate.brandName].filter(Boolean).join(' ').toLowerCase();
        const candidateTokens = new Set(candidateName.split(/[^\w]+/).filter(t => t.length > 2));
        const missingTokens = mustHaveTokens.filter(token => {
            if (candidateTokens.has(token)) return false;
            const regex = new RegExp(`\\b${token}\\b`, 'i');
            if (regex.test(candidateName)) return false;
            return true;
        });
        if (missingTokens.length > 0) {
            reasons.push(`MISSING_TOKENS(${missingTokens.join(',')})`);
        }

        const status = reasons.length === 0 ? '✓ PASS' : `✗ ${reasons.join(' + ')}`;
        console.log(`    ${status} — "${candidate.name}" [${candidate.source}]`);
    }

    // Run full filter
    const filterResult = filterCandidatesByTokens(candidates, normalized, { debug: false, rawLine });
    console.log(`\n  Full filter: ${filterResult.filtered.length} kept, ${filterResult.removedCount} removed`);
    if (filterResult.filtered.length > 0) {
        for (const c of filterResult.filtered.slice(0, 3)) {
            console.log(`    ✓ "${c.name}" [${c.source}]`);
        }
    }
}

function extractNutrients(candidate: UnifiedCandidate): any {
    if (candidate.nutrition && candidate.nutrition.per100g) {
        return {
            calories: candidate.nutrition.kcal,
            protein: candidate.nutrition.protein,
            fat: candidate.nutrition.fat,
            carbs: candidate.nutrition.carbs
        };
    }
    if ((candidate as any).rawData?.nutrientsPer100g) {
        return (candidate as any).rawData.nutrientsPer100g;
    }
    return null;
}

async function main() {
    // Suppress structured logger by setting LOG_LEVEL
    process.env.LOG_LEVEL = 'error';

    for (const ingredient of INGREDIENTS_TO_TEST) {
        await diagnoseIngredient(ingredient);
    }
    process.exit(0);
}

main().catch(console.error);
