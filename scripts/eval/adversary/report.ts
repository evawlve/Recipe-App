/**
 * report.ts — markdown for sync-docs/adversary-latest.md and its Mode G sibling.
 *
 * sync-docs/ is gitignored in this repo and carried by Syncthing (like the flywheel's
 * flywheel-latest.md), so every machine sees the newest report; dated copies with the
 * full JSON go to logs/adversary/, which is Syncthing-ignored on the Mac.
 */
import type { TierDHit } from './tier-d';
import type { CallRecord, Verdict } from './judge';
import { totals } from './judge';

export interface Flag {
    mode: 'O' | 'G';
    /** MEL id(s) for Mode O; the probe line for Mode G. */
    ref: string;
    line: string;
    hours: string;
    tier: string | null;
    foodId: string | null;
    foodName: string | null;
    brand: string | null;
    grams: number | null;
    kcal: number | null;
    tierD: TierDHit[];
    verdict: Verdict | null;
    vanished?: string;
}

export function md(s: unknown): string {
    return String(s ?? '').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

export function table(header: string[], rows: string[][]): string {
    if (!rows.length) return '_none_\n';
    return [
        `| ${header.join(' | ')} |`,
        `|${header.map(() => '---').join('|')}|`,
        ...rows.map(r => `| ${r.map(md).join(' | ')} |`),
    ].join('\n') + '\n';
}

const num = (x: number | null, d = 1) => (x == null ? '—' : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(d));

export function why(f: Flag): string {
    const parts: string[] = [];
    if (f.vanished) parts.push(`VANISHED: ${f.vanished}`);
    for (const h of f.tierD) parts.push(`${h.rule}: ${h.detail}`);
    if (f.verdict && f.verdict.verdict !== 'OK') {
        parts.push(`judge ${f.verdict.verdict}${f.verdict.axis && f.verdict.axis !== 'none' ? ` (${f.verdict.axis})` : ''}`
            + `${f.verdict.expectedGrams != null ? `, expects ~${num(f.verdict.expectedGrams)} g` : ''}: ${f.verdict.reason}`
            + `${f.verdict.error ? ` [${f.verdict.error}]` : ''}`);
    }
    return parts.join(' · ');
}

export function flagTable(flags: Flag[]): string {
    return table(
        ['mode', 'MEL id / probe', 'line', 'event hours (PDT)', 'tier', 'food', 'g', 'kcal', 'why'],
        flags.map(f => [
            f.mode, f.ref, f.line, f.hours, f.tier ?? '—',
            `${f.foodName ?? '—'}${f.brand ? ` [${f.brand}]` : ''} \`${f.foodId ?? '—'}\``,
            num(f.grams), num(f.kcal), why(f),
        ]),
    );
}

export function usageTable(calls: CallRecord[]): string {
    const t = totals(calls);
    const rows = calls.map((c, i) => [
        String(i + 1), c.purpose, `${c.arm} ${c.model}`, String(c.rows),
        String(c.inputTokens), String(c.cacheCreationTokens), String(c.cacheReadTokens), String(c.outputTokens),
        c.costUsd == null ? '—' : `$${c.costUsd.toFixed(4)}`, `${(c.durationMs / 1000).toFixed(1)} s`, c.error ?? '',
    ]);
    rows.push(['**total**', '', '', '', String(t.input), String(t.cacheCreation), String(t.cacheRead), String(t.output),
        `$${t.costUsd.toFixed(4)}`, '', t.failed ? `${t.failed} failed` : '']);
    return table(['call', 'purpose', 'judge', 'rows', 'input', 'cache write', 'cache read', 'output', 'notional $', 'time', 'error'], rows);
}

export const FLAG_IS_NOT_A_VERDICT = 'A flag is not a verdict. Every flag gets a reproduction (a keyed `nosave=1` probe, the '
    + 'record read, the shipped function called with the exact inputs) before it becomes a golden case, a punch row or '
    + 'anything else. This loop never writes a golden case, a `knownIssue` pin, a punch row or a `FoodMapping` row, and '
    + 'never evicts, warms, deploys or flips a flag.';
