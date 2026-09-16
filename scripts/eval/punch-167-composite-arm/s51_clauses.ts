/**
 * s51_clauses.ts — Lane A S51, punch #167 fix-forward (ROW 0(c)). PURE: no import of the
 * codebase, no DB, no LLM.
 *
 * REPLICAS of the three clauses of `brandAlreadyPresent()` in
 * `src/lib/mapping/quantity-word-brand.ts` (tree `9d97675`, backend #438), plus its two
 * module-private helpers `foldBrandTokens()` and `dropPluralS()`, copied verbatim. Every
 * consumer SELF-CHECKS `c1 || c2 || c3` against the SHIPPED `brandAlreadyPresent()` on every
 * pair it evaluates and aborts on a mismatch, so a number printed off these replicas is
 * only ever printed after the shipped function agreed with them on that exact population.
 *
 * Predicates under test (guard 1 = `preserveDroppedBrand()`'s two containment checks):
 *   PRE438  = c1                                  (reference: guard 1 before #438)
 *   SHIPPED = c1 || c2 || c3                      (#438)
 *   C1      = c1 || c3                            (guard 1 without clause 2)
 *   C2      = c1 || (c2 && fold(brand) > 1 word) || c3
 */
import * as fs from 'fs';

/** Verbatim copy of the module-private `foldBrandTokens()`. */
export function foldBrandTokens(value: string): string[] {
    return value
        .toLowerCase()
        .replace(/['’`]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[-.\/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

/** Verbatim copy of the module-private `dropPluralS()`. */
export function dropPluralS(token: string): string {
    return token.replace(/(?<=\w{3})s$/, '');
}

/** Clause 1: contiguous, case-insensitive. */
export function c1(text: string | undefined, brand: string): boolean {
    return (text ?? '').toLowerCase().includes(brand.toLowerCase());
}

/** Clause 2: contiguous after an alphanumeric fold, plural-tolerant. */
export function c2(text: string | undefined, brand: string): boolean {
    if (!text) return false;
    const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const foldedBrand = alnum(brand);
    const foldedText = alnum(text);
    return foldedBrand.length > 0
        && (foldedText.includes(foldedBrand) || foldedText.includes(dropPluralS(foldedBrand)));
}

/** Clause 3: every folded brand word present, any order, plural-tolerant. */
export function c3(text: string | undefined, brand: string): boolean {
    if (!text) return false;
    const brandWords = foldBrandTokens(brand).map(dropPluralS);
    if (brandWords.length === 0) return false;
    const textWords = new Set(foldBrandTokens(text).map(dropPluralS));
    return brandWords.every(word => textWords.has(word));
}

export type Pred = (text: string | undefined, brand: string) => boolean;

export const PRE438: Pred = (t, b) => c1(t, b);
export const SHIPPED_REPLICA: Pred = (t, b) => c1(t, b) || c2(t, b) || c3(t, b);
export const C1: Pred = (t, b) => c1(t, b) || c3(t, b);
export const C2: Pred = (t, b) => c1(t, b) || (c2(t, b) && foldBrandTokens(b).length > 1) || c3(t, b);

/** Clause combination as three bits, c1c2c3. */
export function combo(text: string | undefined, brand: string): string {
    return `${c1(text, brand) ? 1 : 0}${c2(text, brand) ? 1 : 0}${c3(text, brand) ? 1 : 0}`;
}

/** THE CLASS: a one-word folded brand held present by clause 2 alone (`rx bars` / `rxbar`). */
export function isClass(text: string | undefined, brand: string): boolean {
    return foldBrandTokens(brand).length === 1 && c2(text, brand) && !c1(text, brand) && !c3(text, brand);
}

export type Outcome = { baseName: string; applied: boolean; declined: string | null };
export type GuardArgs = { rawLine: string; baseName: string; targetBrand: string; rederived: string; parsed: any };

/**
 * Replica of `preserveDroppedBrand()` with BOTH containment checks injectable. The
 * `brandWasConsumedAsQuantity()` refusal is the SHIPPED function, passed in.
 */
export function preserveReplica(a: GuardArgs, pred: Pred, consumed: (r: string, b: string, p: any) => boolean): Outcome {
    if (pred(a.baseName, a.targetBrand)) return { baseName: a.baseName, applied: false, declined: null };
    if (consumed(a.rawLine, a.targetBrand, a.parsed)) {
        return { baseName: a.baseName, applied: false, declined: 'brand_consumed_as_quantity' };
    }
    return {
        baseName: pred(a.rederived, a.targetBrand) ? a.rederived : `${a.targetBrand} ${a.rederived}`.trim(),
        applied: true,
        declined: null,
    };
}

/**
 * Replica of `repairDroppedBrand()` with its `brandAlreadyPresent()` call injectable.
 * `candidateMatchesTargetBrand()` is the SHIPPED function, passed in.
 */
export function repairReplica(
    name: string | undefined, targetBrand: string, pred: Pred,
    candidateMatches: (brandName: string | undefined, candidateName: string, targetBrand: string) => boolean,
): string | null {
    if (!name) return null;
    if (candidateMatches(undefined, name, targetBrand)) return null;
    if (pred(name, targetBrand)) return null;
    const tokens = `${targetBrand} ${name}`.trim().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const t of tokens) {
        if (out.length > 0 && out[out.length - 1].toLowerCase() === t.toLowerCase()) continue;
        out.push(t);
    }
    return out.join(' ');
}

export const sameOutcome = (x: Outcome, y: Outcome) =>
    x.baseName === y.baseName && x.applied === y.applied && (x.declined ?? null) === (y.declined ?? null);

/** RFC 4180 CSV reader; aborts unless every row has exactly `width` fields. */
export function readCsv(path: string, width: number): string[][] {
    const text = fs.readFileSync(path, 'utf8');
    const rows: string[][] = [];
    let row: string[] = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
            } else field += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(field); field = '';
            rows.push(row); row = [];
        } else field += ch;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    const bad = rows.filter(r => r.length !== width);
    if (bad.length > 0) {
        console.log(`CSV SHAPE ABORT: ${bad.length} rows without ${width} fields, first ${JSON.stringify(bad[0])}`);
        process.exit(2);
    }
    return rows;
}

export const TUPLES_CSV = require('path').join(__dirname, 's51_seg_tuples.csv');

export type Tuple = { idx: number; rawText: string; normalizedForm: string; brand: string };

export function readTuples(path = TUPLES_CSV): Tuple[] {
    const rows = readCsv(path, 3);
    const header = rows.shift();
    if (JSON.stringify(header) !== JSON.stringify(['rawText', 'normalizedForm', 'brand'])) {
        console.log(`CSV HEADER ABORT: ${JSON.stringify(header)}`);
        process.exit(2);
    }
    return rows.map((r, idx) => ({ idx, rawText: r[0], normalizedForm: r[1], brand: r[2] }));
}
