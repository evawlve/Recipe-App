/**
 * _dump_prompts.ts — emit the EXACT Tier-L prompts for the 81 hand-labelled batch-01
 * rows, so an agent-based screen can be measured against the API-based one on
 * byte-identical input. If the agent gets a different rubric we would be measuring the
 * rubric, not the shape.
 *
 * Read-only, offline (the fixture carries `row.real`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { LLM_SYSTEM, llmUserPrompt, ScreenRow } from './correctness-screen';

const FIXTURE = path.join(__dirname, '__tests__', 'fixtures', 'correctness-screen-batch01.json');

const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
    rows: Array<{ verdict: 'GOOD' | 'SUSPECT' | 'BAD'; row: ScreenRow }>;
};

const out = {
    system: LLM_SYSTEM,
    rows: fx.rows.map((e, i) => ({
        idx: i,
        key: e.row.key,
        label: e.verdict,          // ground truth — NOT shown to the judge
        prompt: llmUserPrompt(e.row),
    })),
};

const dest = process.argv[2] ?? '/tmp/screen-llm/agent-eval/prompts.json';
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log(`wrote ${out.rows.length} prompts -> ${dest}`);
console.log(`labels: ${JSON.stringify(out.rows.reduce((a, r) => ({ ...a, [r.label]: (a[r.label] ?? 0) + 1 }), {} as Record<string, number>))}`);
console.log(`system prompt: ${LLM_SYSTEM.length} chars`);
