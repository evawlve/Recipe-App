/**
 * _seg_ab_driver.ts — offline segmentation arm driver (2026-08-11; committed
 * 2026-08-12 when it became the gate for segmenter prompt/version changes).
 * Calls segmentTextWithAi() directly — cache-free by construction
 * (SegmentationCache lives in the parse route, not here), so this driver can
 * neither read nor write any DB state. Scoring lives beside the corpus:
 * sync-docs/segmentation-recall-2026-08-11/ab-2026-08-11/_regrade_and_score.py
 * (mobile repo). Any run bills OpenRouter ~$0.02 (296 calls at mini rates).
 *
 * Arm env is set on the CLI (pre-set env beats .env because dotenv never
 * overrides an existing var, including an empty one):
 *   OLLAMA_ENABLED=false CHEAP_AI_MODEL_PRIMARY=<slug> CHEAP_AI_MODEL_FALLBACK=<slug> \
 *   OPENAI_API_KEY= npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_seg_ab_driver.ts \
 *     --labels <labels.tsv> --out <arm.tsv> --arm <name>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { segmentTextWithAi } from '@/lib/nlp/ai-segmenter';
import { getLlmUsageSnapshot } from '@/lib/ai/llm-usage-metrics';

function argValue(name: string): string | null {
    const i = process.argv.indexOf(name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
    const labelsPath = argValue('--labels');
    const outPath = argValue('--out');
    const armName = argValue('--arm') ?? 'unnamed';
    if (!labelsPath || !outPath) {
        console.error('usage: _seg_ab_driver.ts --labels <tsv> --out <tsv> [--arm <name>]');
        process.exit(1);
    }
    const lines = fs.readFileSync(labelsPath, 'utf8').split('\n').filter(Boolean);
    const header = lines[0].split('\t');
    const col = (name: string) => header.indexOf(name);
    const iIdx = col('idx'), iLine = col('line'), iGraded = col('gradedItems'), iVerdict = col('verdict');
    if (iIdx < 0 || iLine < 0 || iGraded < 0 || iVerdict < 0) {
        console.error('labels TSV missing expected columns'); process.exit(1);
    }
    const rows = lines.slice(1).map(l => l.split('\t'));
    const out = fs.createWriteStream(outPath);
    out.write('idx\tdraw\ttruth\tcorpusVerdict\tstatus\titemCount\titemsJson\tms\tline\n');
    let calls = 0, nulls = 0;
    const t0 = Date.now();
    for (const r of rows) {
        const idx = r[iIdx], line = r[iLine], truth = r[iGraded], verdict = r[iVerdict];
        const draws = (parseInt(truth, 10) >= 2 || verdict !== 'AGREE') ? 3 : 1;
        for (let d = 1; d <= draws; d++) {
            const s = Date.now();
            let items = null;
            try { items = await segmentTextWithAi(line); } catch { items = null; }
            const ms = Date.now() - s;
            calls++;
            if (items === null) {
                nulls++;
                out.write(`${idx}\t${d}\t${truth}\t${verdict}\tnull\t0\t[]\t${ms}\t${line}\n`);
            } else {
                const compact = items.map(it => ({ r: it.rawText, n: it.normalizedForm, b: it.brand }));
                const j = JSON.stringify(compact).replace(/\t/g, ' ').replace(/\n/g, ' ');
                out.write(`${idx}\t${d}\t${truth}\t${verdict}\tok\t${items.length}\t${j}\t${ms}\t${line}\n`);
            }
        }
    }
    out.end();
    const meta = {
        arm: armName,
        effectiveEnv: {
            CHEAP_AI_MODEL_PRIMARY: process.env.CHEAP_AI_MODEL_PRIMARY ?? '(default)',
            CHEAP_AI_MODEL_FALLBACK: process.env.CHEAP_AI_MODEL_FALLBACK ?? '(default)',
            OLLAMA_ENABLED: process.env.OLLAMA_ENABLED ?? '(default)',
            OPENAI_API_KEY_blanked: (process.env.OPENAI_API_KEY ?? '') === '',
        },
        calls, nulls, wallMs: Date.now() - t0,
        llmUsage: getLlmUsageSnapshot(),
    };
    fs.writeFileSync(outPath.replace(/\.tsv$/, '') + '.meta.json', JSON.stringify(meta, null, 1));
    console.log(`arm=${armName} calls=${calls} nulls=${nulls} wall=${Math.round((Date.now() - t0) / 1000)}s -> ${outPath}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
