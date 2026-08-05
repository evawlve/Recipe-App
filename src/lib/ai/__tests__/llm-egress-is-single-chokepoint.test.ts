/**
 * DRIFT GUARD for the coverage claim behind the Phase 0.5(c) counters.
 *
 * The counters live in `makeRequest()` in `structured-client.ts`. The sentence they buy —
 * "`/api/ok` counts all reachable LLM egress" — is only true while that function is the only
 * reachable place a `chat/completions` request is built. Written as a comment that would be a lie
 * the day someone adds a fifth direct-fetch module; written as this test, it goes red instead.
 *
 * MEASURED 2026-08-04 on master @ 136d0e5 (re-derive:
 *   `grep -rl "chat/completions" --include="*.ts" src | grep -v __tests__ | wc -l`  ->  4
 * ): four files build an OpenAI-shaped request. One is the chokepoint. THREE ARE UNREACHABLE —
 * they are exported, they build their own request, and none of them would ever touch the counter.
 * They are a coverage hole waiting to open, not a coverage hole today, and the second assertion
 * below is what keeps that distinction checked: if any of them acquires a caller, this reddens and
 * the counter's coverage claim must be revisited rather than silently becoming false.
 *
 * NOT a dead-code claim. "A rule that exists with a caller that never reaches it" is this repo's
 * signature bug (six confirmed instances), so deleting these three is a separate, evidenced
 * decision. This test only asserts what is currently reachable.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(process.cwd(), 'src');
const REPO = process.cwd();

/** Frozen allowlist, measured 2026-08-04. A fifth direct-fetch module reddens this. */
const EGRESS_ALLOWLIST = [
    'src/lib/ai/structured-client.ts',
    'src/lib/mapping/ai-rerank.ts',
    'src/lib/mapping/ai-search-refine.ts',
    'src/lib/mapping/ai-synonym-generator.ts',
].sort();

/** The chokepoint. The other three are the ones that must stay callerless. */
const CHOKEPOINT = 'src/lib/ai/structured-client.ts';

/**
 * LLM entry points of the three non-chokepoint modules. `RESPONSE_SCHEMA` is deliberately not
 * listed — it is a name each of the three exports, so it cannot distinguish them.
 */
const UNREACHED_ENTRY_POINTS: Record<string, string> = {
    rerankFatsecretCandidates: 'src/lib/mapping/ai-rerank.ts',
    refineSearchQuery: 'src/lib/mapping/ai-search-refine.ts',
    generateSynonymsWithAi: 'src/lib/mapping/ai-synonym-generator.ts',
    generateAndSaveSynonyms: 'src/lib/mapping/ai-synonym-generator.ts',
};

function walkTs(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            walkTs(full, acc);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.includes('.test.')) {
            acc.push(full);
        }
    }
    return acc;
}

/** Repo-relative, forward-slashed, so the assertion message reads the same on every machine. */
function rel(full: string): string {
    return path.relative(REPO, full).split(path.sep).join('/');
}

describe('LLM egress is a single counted chokepoint', () => {
    it('the direct-fetch allowlist is four files', () => {
        const found = walkTs(SRC)
            .filter((f) => fs.readFileSync(f, 'utf8').includes('chat/completions'))
            .map(rel)
            .sort();

        expect(found).toEqual(EGRESS_ALLOWLIST);
    });

    it('the counted chokepoint is one of them and is where makeRequest lives', () => {
        expect(EGRESS_ALLOWLIST).toContain(CHOKEPOINT);
        const src = fs.readFileSync(path.join(REPO, CHOKEPOINT), 'utf8');
        expect(src).toContain('recordLlmResponse(');
        expect(src).toContain('async function makeRequest(');
    });

    it('the three uncounted direct-fetch entry points have no non-test caller', () => {
        // Walk src/, scripts/ and eval/ rather than shelling out to grep, so this runs identically
        // on the Mac, the Windows PC and the box.
        const roots = ['src', 'scripts', 'eval']
            .map((d) => path.join(REPO, d))
            .filter((d) => fs.existsSync(d));

        const files = roots.flatMap((r) => walkTs(r));

        const callers: Record<string, string[]> = {};
        for (const [name, definedIn] of Object.entries(UNREACHED_ENTRY_POINTS)) {
            callers[name] = files
                .filter((f) => {
                    // Only the DEFINING file is exempt — the definition itself, plus (in
                    // ai-synonym-generator.ts) one internal call. Exempting the whole
                    // src/lib/mapping/ai-* prefix would hide a caller added in a sibling module,
                    // which is precisely the drift this test exists to catch.
                    if (rel(f) === definedIn) return false;
                    return fs.readFileSync(f, 'utf8').includes(name);
                })
                .map(rel);
        }

        expect(callers).toEqual({
            rerankFatsecretCandidates: [],
            refineSearchQuery: [],
            generateSynonymsWithAi: [],
            generateAndSaveSynonyms: [],
        });
    });
});
