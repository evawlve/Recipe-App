/**
 * filters.ts — which MappingEventLog events Mode O may screen, and how they group.
 *
 * Pure. MEL has no user id, no nosave flag and no request id, and it writes `rawLine`
 * once per resolved item, so "whose line is this" is not observable. What survives
 * these filters is "`noCache=false`, non-sweep traffic" — never "Diego's lines". Every
 * drop carries its reason, and the report prints the counts per reason, so a filter that
 * swallowed a real line is visible rather than silent.
 *
 * Drop order (first reason wins):
 *   hour-04         the PDT hour is 04 — the nightly flywheel sweep's warm + eval band.
 *                   `createdAt` is `timestamp without time zone` holding UTC, so the SQL
 *                   converts it TWICE (CLAUDE.md §Deploying); `pt` arrives already local.
 *   lane-a-probe    inside a Lane A session's probe window as its write-off's bracket
 *                   table attributes it (lane-a-probe-windows.json). A WINDOW, not a
 *                   line: S60 probed the s'mores line at 21:02 on 09-27 with the same text
 *                   the organic 09-25 event carries, so a line filter would drop the one
 *                   event this screen exists to catch.
 *   adversary-probe a Mode G probe from this loop's own ledger (logs/adversary-probed.tsv):
 *                   the probed line or any MEL rawLine it wrote, inside [start, end].
 *   script-string   exactly (after normalisation) a golden-set line, a coverage-corpus seed
 *                   or a warm-corpus seed — our instruments' vocabulary.
 *   sweep-string    a rawLine the sweep itself sent in some 04:xx PDT hour of the lookback
 *                   (the flywheel's telemetry seeds are normalizedForm keys it re-sends as
 *                   lines; this reads them from MEL rather than re-deriving the sweep).
 */

export interface MelEvent {
    id: string;
    /** `createdAt` as stored (UTC, no zone), ISO-ish `YYYY-MM-DD HH:MM:SS`. */
    utc: string;
    /** The same instant in America/Los_Angeles, `YYYY-MM-DD HH:MM:SS`. */
    pt: string;
    rawLine: string;
    normalizedForm: string | null;
    foodId: string | null;
    foodName: string | null;
    brandName: string | null;
    source: string | null;
    servingTier: string | null;
    grams: number | null;
    totalKcal: number | null;
    funnelStage: string | null;
    cacheHit: string | null;
}

export interface ProbeWindow {
    session: string;
    /** Inclusive, PDT, `YYYY-MM-DD HH:MM:SS`. */
    startPt: string;
    endPt: string;
    /** The write-off line that attributes the window. */
    source: string;
}

export interface LedgerEntry {
    line: string;
    startUtc: string;
    endUtc: string;
    melRawLines: string[];
}

export type DropReason = 'hour-04' | 'lane-a-probe' | 'adversary-probe' | 'script-string' | 'sweep-string';

export interface FilterInputs {
    scriptStrings: Set<string>;
    sweepStrings: Set<string>;
    windows: ProbeWindow[];
    ledger: LedgerEntry[];
}

export interface Dropped { event: MelEvent; reason: DropReason; by?: string }

/** Lowercase, curly quotes folded, whitespace collapsed. The ONE comparison key for lines. */
export function normLine(s: string): string {
    return s.toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim();
}

/** `YYYY-MM-DD HH:MM:SS` (or ISO with T / Z / millis) → comparable `YYYY-MM-DD HH:MM:SS`. */
export function stamp(s: string): string {
    return s.replace('T', ' ').replace(/Z$/, '').replace(/\.\d+$/, '').slice(0, 19);
}

export function hourOf(pt: string): number {
    return Number(stamp(pt).slice(11, 13));
}

export function inWindow(pt: string, w: ProbeWindow): string | null {
    const t = stamp(pt);
    return t >= stamp(w.startPt) && t <= stamp(w.endPt) ? w.session : null;
}

/** Parse logs/adversary-probed.tsv: `line \t startUtc \t endUtc \t melRawLine | melRawLine ...`. */
export function parseLedger(text: string): LedgerEntry[] {
    const out: LedgerEntry[] = [];
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '');
        if (!line.trim() || line.startsWith('#')) continue;
        const [l, s, e, mel] = line.split('\t');
        if (!l || !s || !e) continue;
        out.push({ line: l, startUtc: s, endUtc: e, melRawLines: (mel ?? '').split(' | ').map(x => x.trim()).filter(Boolean) });
    }
    return out;
}

/** One ledger row. Tabs and newlines inside the line are flattened so the file stays one row per probe. */
export function formatLedgerRow(e: LedgerEntry): string {
    const flat = (s: string) => s.replace(/[\t\r\n]+/g, ' ');
    return [flat(e.line), e.startUtc, e.endUtc, e.melRawLines.map(flat).join(' | ')].join('\t') + '\n';
}

function ledgerHit(ev: MelEvent, ledger: LedgerEntry[]): string | null {
    const t = stamp(ev.utc);
    const n = normLine(ev.rawLine);
    for (const e of ledger) {
        if (t < stamp(e.startUtc) || t > stamp(e.endUtc)) continue;
        if (normLine(e.line) === n || e.melRawLines.some(m => normLine(m) === n)) return e.line;
    }
    return null;
}

export function applyFilters(events: MelEvent[], f: FilterInputs): { kept: MelEvent[]; dropped: Dropped[] } {
    const kept: MelEvent[] = [];
    const dropped: Dropped[] = [];
    for (const ev of events) {
        if (hourOf(ev.pt) === 4) { dropped.push({ event: ev, reason: 'hour-04' }); continue; }
        const w = f.windows.map(x => inWindow(ev.pt, x)).find(Boolean);
        if (w) { dropped.push({ event: ev, reason: 'lane-a-probe', by: w }); continue; }
        const l = ledgerHit(ev, f.ledger);
        if (l) { dropped.push({ event: ev, reason: 'adversary-probe', by: l }); continue; }
        const n = normLine(ev.rawLine);
        if (f.scriptStrings.has(n)) { dropped.push({ event: ev, reason: 'script-string' }); continue; }
        if (f.sweepStrings.has(n)) { dropped.push({ event: ev, reason: 'sweep-string' }); continue; }
        kept.push(ev);
    }
    return { kept, dropped };
}

/** One screened unit: every event of the same line resolving to the same record at the same grams. */
export interface EventGroup {
    key: string;
    rep: MelEvent;
    events: { id: string; pt: string }[];
}

export function groupEvents(events: MelEvent[]): EventGroup[] {
    const by = new Map<string, EventGroup>();
    for (const ev of events) {
        const key = `${normLine(ev.rawLine)}|${ev.foodId ?? ''}|${ev.grams == null ? '' : ev.grams.toFixed(1)}`;
        const g = by.get(key);
        if (g) g.events.push({ id: ev.id, pt: ev.pt });
        else by.set(key, { key, rep: ev, events: [{ id: ev.id, pt: ev.pt }] });
    }
    for (const g of by.values()) g.events.sort((a, b) => a.pt.localeCompare(b.pt));
    return [...by.values()];
}

/** `09-25 18:01, 09-27 21:02 (+3 more)` — the event hours a reader needs to tell a sitting from use. */
export function eventHours(g: EventGroup, max = 6): string {
    const hm = g.events.map(e => stamp(e.pt).slice(5, 16));
    const shown = hm.slice(0, max).join(', ');
    return hm.length > max ? `${shown} (+${hm.length - max} more)` : shown;
}
