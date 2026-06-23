/**
 * Diagnostic: trace every step of the egg substitute mapping
 * Shows: all candidates from both APIs, filter status, scores
 */
import { gatherCandidates, type UnifiedCandidate } from '../src/lib/fatsecret/gather-candidates';
import {
    hasCriticalModifierMismatch,
    isReplacementMismatch,
    hasCoreTokenMismatch,
    filterCandidatesByTokens
} from '../src/lib/fatsecret/filter-candidates';
import { simpleRerank } from '../src/lib/fatsecret/simple-rerank';

async function main() {
    const raw = '0.25 cup fat free liquid egg substitute';
    const normalizedName = 'fat free egg substitute';
    const parsed = { qty: 0.25, unit: 'cup', name: 'fat free liquid egg substitute', multiplier: 1 } as any;

    console.log('=== Step 1: Gather Candidates ===');
    console.log(`Raw: "${raw}"`);
    console.log(`Normalized: "${normalizedName}"`);
    console.log();

    const candidates = await gatherCandidates(raw, parsed, normalizedName, { skipCache: true });

    console.log(`Total gathered: ${candidates.length}`);
    console.log();

    // Show all candidates by source
    const bySource: Record<string, UnifiedCandidate[]> = {};
    for (const c of candidates) {
        (bySource[c.source] ??= []).push(c);
    }

    for (const [source, items] of Object.entries(bySource)) {
        console.log(`--- ${source.toUpperCase()} candidates (${items.length}) ---`);
        for (const c of items) {
            console.log(`  ${c.id} | ${c.name}${c.brandName ? ` (${c.brandName})` : ''} | score=${c.score.toFixed(3)}`);
        }
        console.log();
    }

    // Step 2: Apply filters individually
    console.log('=== Step 2: Filter Analysis ===');
    for (const c of candidates) {
        const modMismatch = hasCriticalModifierMismatch(raw, c.name, c.source);
        const replMismatch = isReplacementMismatch(raw, c.name, c.brandName);
        const coreMismatch = hasCoreTokenMismatch(normalizedName, c.name, c.brandName);

        const filters: string[] = [];
        if (modMismatch) filters.push('MOD');
        if (replMismatch) filters.push('REPL');
        if (coreMismatch) filters.push('CORE');

        const status = filters.length === 0 ? 'PASS' : 'REJECT(' + filters.join('+') + ')';
        console.log(`  ${status.padEnd(20)} | ${c.name}${c.brandName ? ` (${c.brandName})` : ''}`);
    }
    console.log();

    // Step 3: Apply full filterCandidatesByTokens
    console.log('=== Step 3: Full filterCandidatesByTokens ===');
    const filterResult = filterCandidatesByTokens(candidates, normalizedName, { debug: true, rawLine: raw });
    console.log(`  Passed: ${filterResult.filtered.length}, Removed: ${filterResult.removedCount}`);
    for (const c of filterResult.filtered) {
        console.log(`  SURVIVED: ${c.name}${c.brandName ? ` (${c.brandName})` : ''} | score=${c.score.toFixed(3)}`);
    }
    console.log();

    // Step 4: Apply core_token_mismatch filter (same as pipeline step 3b)
    const afterCoreFilter = filterResult.filtered.filter(c => {
        const mismatch = hasCoreTokenMismatch(normalizedName, c.name, c.brandName);
        if (mismatch) console.log(`  CORE_REJECTED: ${c.name}`);
        return !mismatch;
    });
    console.log(`  After core filter: ${afterCoreFilter.length} remaining`);
    console.log();

    // Step 5: Run simple_rerank
    if (afterCoreFilter.length > 0) {
        console.log('=== Step 4: Simple Rerank ===');
        const reranked = simpleRerank(afterCoreFilter, normalizedName, raw);
        console.log(`  Top candidate: ${reranked[0]?.name} | score=${reranked[0]?.score.toFixed(4)}`);
        console.log(`  Threshold: 0.8`);
        console.log(`  Would pass: ${(reranked[0]?.score ?? 0) >= 0.8 ? 'YES' : 'NO (score too low)'}`);
        console.log();
        console.log('  All reranked:');
        for (const c of reranked.slice(0, 10)) {
            console.log(`    ${c.score.toFixed(4)} | ${c.name}${c.brandName ? ` (${c.brandName})` : ''}`);
        }
    }
}

main().catch(console.error).finally(() => process.exit(0));
