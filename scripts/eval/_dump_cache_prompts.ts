/**
 * _dump_cache_prompts.ts — emit the exact Tier-L record card for every cached row, so a
 * Claude Code agent fleet can audit the cache on the same evidence the API screen used.
 *
 * Attribution is PINS ONLY. `attribute()`'s Jaccard fallback was measured on 2026-07-27
 * to evict at 44.8% vs 26.8% for pinned rows — a nearest-match seed is a guess that
 * manufactures identity mismatches, so an unpinned row gets an EMPTY phrase and the
 * judge is told the key is token-sorted rather than being handed a scrambled string
 * dressed up as a query.
 *
 * THE PINS FILE IS LOAD-BEARING and gets refused when it cannot be trusted
 * (playbook §11 class B — a broken input must not read as "0 pins, carry on"):
 *   - empty / whitespace-only pins.tsv refuses (a truncated-to-nothing file would
 *     silently un-pin all 3,248 rows and the audit would measure the wrong thing);
 *   - any non-empty line that is not `key<TAB>phrase` with both parts non-empty
 *     refuses with expected-vs-observed (_recover_seeds.ts emits exactly that shape,
 *     so a malformed line means truncation mid-line or the wrong file);
 *   - pins that overlap ZERO of the rows refuse (right shape, wrong key space).
 *
 * Exit codes: 0 = ok, 2 = refused / error.
 *
 * Read-only, offline (rows-final.json carries `row.real`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { llmUserPrompt, LLM_SYSTEM, ScreenRow } from './correctness-screen';

// ---------------------------------------------------------------------------
// Pure, unit-testable guards (scripts/eval/__tests__/cache-ops-void-exits.test.ts)
// ---------------------------------------------------------------------------

export type PinsParse =
    | { ok: true; pins: Map<string, string> }
    | { ok: false; reason: string };

/**
 * Parse a pins.tsv produced by _recover_seeds.ts. Expected: every non-empty
 * line is `key<TAB>phrase`, both non-empty. Anything else refuses with what was
 * expected vs what was observed — never a silently smaller pin set.
 */
export function parsePinsText(text: string): PinsParse {
    if (!text.trim()) {
        return {
            ok: false,
            reason: 'pins file is EMPTY — expected >=1 `key<TAB>phrase` line, observed 0 bytes of content. '
                + 'A truncated or void pins file must not become "every row unpinned".',
        };
    }
    const pins = new Map<string, string>();
    const malformed: { lineNo: number; line: string }[] = [];
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (!ln.trim()) continue;
        const parts = ln.split('\t');
        const [k, p] = parts;
        if (parts.length !== 2 || !k?.trim() || !p?.trim()) {
            malformed.push({ lineNo: i + 1, line: ln });
            continue;
        }
        pins.set(k.trim(), p.trim());
    }
    if (malformed.length) {
        const examples = malformed.slice(0, 5)
            .map(m => `line ${m.lineNo}: ${JSON.stringify(m.line.slice(0, 80))}`)
            .join(' | ');
        return {
            ok: false,
            reason: `pins file is MALFORMED — expected every non-empty line to be \`key<TAB>phrase\` `
                + `(the exact shape _recover_seeds.ts emits), observed ${malformed.length} line(s) that are not `
                + `(truncated mid-line? wrong file?): ${examples}`,
        };
    }
    return { ok: true, pins };
}

/**
 * Pins that are well-formed but touch none of the rows are the WRONG pins —
 * wrong key space or wrong file — and an all-unpinned dump would quietly
 * measure something other than what the operator asked for.
 */
export function pinCoverageCheck(
    rowKeys: string[],
    pins: Map<string, string>,
): { ok: true; pinned: number } | { ok: false; reason: string } {
    const pinned = rowKeys.filter(k => pins.has(k)).length;
    if (pinned === 0) {
        return {
            ok: false,
            reason: `pins file matches ZERO rows — expected >=1 of the ${rowKeys.length} row key(s) to be pinned `
                + `by the ${pins.size} pin(s), observed 0. The pins are in a different key space than the rows `
                + '(wrong pins file? keys not canonicalized?).',
        };
    }
    return { ok: true, pinned };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(): number {
    const rowsPath = process.argv[2];
    const seedsPath = process.argv[3];
    const outDir = process.argv[4];
    const perAgent = Number(process.argv[5] ?? 27);
    if (!rowsPath || !seedsPath || !outDir) {
        throw new Error('usage: _dump_cache_prompts.ts <rows.json> <pins.tsv> <outDir> [perAgent]');
    }

    const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8')) as ScreenRow[];

    let pinsText: string;
    try { pinsText = fs.readFileSync(seedsPath, 'utf8'); } catch (e) {
        console.error(`REFUSING: cannot read pins file ${seedsPath}: ${(e as Error).message}`);
        return 2;
    }
    const parsed = parsePinsText(pinsText);
    if (!parsed.ok) {
        console.error(`REFUSING: ${parsed.reason}`);
        return 2;
    }
    const pins = parsed.pins;

    const coverage = pinCoverageCheck(rows.map(r => r.key), pins);
    if (!coverage.ok) {
        console.error(`REFUSING: ${coverage.reason}`);
        return 2;
    }

    let pinned = 0;
    const cards = rows.map((r, i) => {
        const seed = pins.get(r.key) ?? '';
        if (seed) pinned++;
        // llmUserPrompt reads r.seed; set it explicitly rather than relying on attribute().
        const withSeed = { ...r, seed } as ScreenRow;
        return { idx: i, key: r.key, hasPhrase: Boolean(seed), prompt: llmUserPrompt(withSeed) };
    });

    fs.mkdirSync(outDir, { recursive: true });
    let files = 0;
    for (let i = 0; i < cards.length; i += perAgent) {
        fs.writeFileSync(
            path.join(outDir, `batch-${String(files).padStart(3, '0')}.json`),
            JSON.stringify({ system: LLM_SYSTEM, rows: cards.slice(i, i + perAgent) }, null, 1),
        );
        files++;
    }
    fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify({
        total: cards.length, perAgent, files, pinned, unpinned: cards.length - pinned,
    }, null, 1));
    console.log(`${cards.length} cards (${pinned} with a real shopper phrase, ${cards.length - pinned} without)`);
    console.log(`-> ${files} batch file(s) of <=${perAgent} rows in ${outDir}`);
    return 0;
}

if (require.main === module) {
    try {
        process.exit(main());
    } catch (e) {
        console.error(e);
        process.exit(2);
    }
}
