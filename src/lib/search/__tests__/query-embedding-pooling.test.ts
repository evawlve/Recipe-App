/**
 * The pooling contract: QUERIES and DOCUMENTS must be pooled the same way, or
 * they sit in different vector spaces and every cosine is meaningless.
 *
 * This defect shipped and survived for months because nothing connected the two
 * sides. `scripts/embed-off-cpu.ts` wrote documents with `pooling: 'cls'`,
 * `embedQuery()` embedded queries with `pooling: 'mean'`, both were internally
 * consistent, and the golden set's five `search/semantic` cases scored 5/5 right
 * through it (backend `sync-docs/backend_integration_guide.md`). A gate that
 * looks at one side can never see this; the only thing that can is a check that
 * compares the two sides to each other.
 *
 * These assertions read the SOURCE TEXT of the writer scripts on purpose. The
 * document pooling is a call-site literal inside a batch loop, not an exported
 * value, so importing the module would drag in Prisma and the ONNX stack and
 * still not expose the argument. Grepping the literal is what actually pins it.
 */
import * as fs from 'fs';
import * as path from 'path';
import { CORPUS_POOLING } from '../query-embedding';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Comments must be stripped first, and that is not incidental: embed-off-cpu.ts's
 * header discusses BOTH poolings at length, so a naive scan reads the prose as
 * two conflicting document poolings and the test fails on a file that is correct.
 */
function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** `pooling: 'x'` in executable code only. */
function poolingLiterals(source: string): string[] {
    const out: string[] = [];
    const re = /pooling\s*[:=]\s*["']([a-z]+)["']/g;
    let m: RegExpExecArray | null;
    const code = stripComments(source);
    while ((m = re.exec(code)) !== null) out.push(m[1]);
    return out;
}

describe('pooling contract: queries and documents share one vector space', () => {
    it('embed-off-cpu.ts writes document vectors with exactly one pooling', () => {
        const found = poolingLiterals(read('scripts/embed-off-cpu.ts'));
        expect(found.length).toBeGreaterThan(0);
        expect(new Set(found).size).toBe(1);
    });

    it("the query side's CORPUS_POOLING equals the pooling embed-off-cpu.ts writes", () => {
        const [docPooling] = poolingLiterals(read('scripts/embed-off-cpu.ts'));
        expect(CORPUS_POOLING).toBe(docPooling);
    });

    it('the Python GPU embedder states no pooling of its own — so this check CANNOT cover it', () => {
        // UNVERIFIABLE FROM SOURCE, stated rather than asserted away. embed_foods.py
        // wrote the original corpus via bare `SentenceTransformer(MODEL_NAME)` and
        // `model.encode(...)`; the pooling is whatever the model repo's
        // 1_Pooling/config.json says (CLS for bge-small-en-v1.5), and the script
        // never names it. So no source-text assertion can pin that side. What DOES
        // pin it empirically is scripts/eval/semantic-recall-probe.ts control C4,
        // which re-embeds a stored document and cosines it against its live vector.
        // This test only guards that the file stays in that shape: the moment it
        // grows an explicit pooling argument, that argument must be compared here.
        const src = stripComments(read('scripts/embed_foods.py'))
            .replace(/^\s*#.*$/gm, '')
            .replace(/"""[\s\S]*?"""/g, '');
        expect(poolingLiterals(src)).toHaveLength(0);
        expect(src).toMatch(/SentenceTransformer\(/);
    });

    it('embedQuery does not hardcode a pooling literal — it must resolve one', () => {
        // A literal here is how the two sides drifted apart in the first place.
        const src = read('src/lib/search/query-embedding.ts');
        const inExtractorCall = /extractor\([^)]*pooling\s*:\s*["']/s.test(src);
        expect(inExtractorCall).toBe(false);
        expect(src).toContain('resolveQueryPooling');
    });

    it('EMBED_QUERY_POOLING is documented in .env.example', () => {
        // The `check` CI job enforces this for src/**; state it here too so the knob
        // cannot be added quietly.
        expect(read('.env.example')).toContain('EMBED_QUERY_POOLING');
    });
});
