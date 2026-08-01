/**
 * _agent_screen_reconcile.ts — turn a fleet of Claude Code agent verdicts into the
 * batch's `screen-evict.txt`, and REFUSE if the fleet did not actually judge the batch.
 *
 * WHERE THIS SITS: `run-batches.sh --screen agent <B>` runs Tier D alone, dumps the rows
 * and the byte-identical Tier-L record cards, and exits 10. A session fans Sonnet agents
 * over the cards and writes `agent-verdicts.json`. Then `--resume` calls THIS, which is
 * the only producer of the evict list. The session does not write the evict file: a
 * hand-assembled list is a transcription step between the judgement and the DELETE, and
 * this whole campaign exists because transcription steps are where the truth goes.
 *
 * THE RECONCILE IS THE POINT (playbook §10): assert 0 missing, 0 duplicate, 0 failed
 * before believing any total. The 2026-07-27 audit's rule was that silent truncation
 * reads as "covered everything" when it did not — an agent that dies mid-batch returns
 * fewer verdicts, and a union built from a short list quietly keeps every row the dead
 * agent would have flagged. So: every row in rows.json must come back exactly once, at
 * the right index, with a verdict this script recognises, or nothing is written at all.
 *
 * THE EVICT SET is `Tier-D EVICT  ∪  agent REJECT`, minus serving-axis rejects.
 *   - UNSURE never evicts. It is a first-class outcome that routes a row to a human
 *     (the full audit returned 104 of them); folding it into the delete list would
 *     convert "I cannot tell" into "destroy it".
 *   - Serving-axis rejects are excluded because an evictor must be actionable by
 *     deleting the row (playbook §2). FoodMapping is identity-only — there is no grams
 *     column — so deleting a row cannot fix a serving weight; it discards a correct
 *     identity and re-resolves the same bad weight. This is the same reasoning that
 *     demoted D5 and D6, and the same 17 rows the whole-cache audit held back.
 *
 * Read-only with respect to the database. Writes only the two output files.
 *
 * Exit codes:
 *   0 = reconciled, nothing to evict
 *   1 = reconciled, rows flagged for withholding (evict file written, non-empty)
 *   2 = REFUSED — the fleet's output does not account for the batch, or an input is
 *       malformed. Nothing is written. A screen that could not be reconciled must never
 *       be read as a clean batch.
 */
import * as fs from 'fs';
import type { ScreenRow, Verdict, RuleId } from './correctness-screen';

// ---------------------------------------------------------------------------
// Pure, unit-testable core (scripts/eval/__tests__/agent-screen-reconcile.test.ts)
// ---------------------------------------------------------------------------

export type AgentDecision = 'ACCEPT' | 'UNSURE' | 'REJECT';

/** One agent verdict, matching the shipped LlmVerdict shape plus the card's idx. */
export interface AgentVerdict {
    idx: number;
    key: string;
    verdict: AgentDecision;
    axis: string;
    confidence?: number;
    reason?: string;
    error?: string;
}

export const VALID_VERDICTS: ReadonlySet<string> = new Set(['ACCEPT', 'UNSURE', 'REJECT']);
export const VALID_AXES: ReadonlySet<string> = new Set(['identity', 'nutrition', 'serving', 'key', 'none']);

/**
 * Rules that may NOT carry an eviction on their own. `balanced` already excludes all
 * three, so this is a tripwire on policy drift rather than a filter that fires today —
 * if someone runs the agent path at `--policy strict`, D1's measured 73.8% live
 * false-evict rate must not ride in behind the agents' reputation.
 */
export const NON_EVICTING_RULES: ReadonlySet<RuleId> = new Set<RuleId>(['D1', 'D5', 'D6']);

export type Reconcile =
    | { ok: true; result: ReconcileResult }
    | { ok: false; reasons: string[] };

export interface ReconcileResult {
    evict: string[];
    /** Agent REJECTs held back because deleting the row cannot fix the defect. */
    servingAxisRejects: string[];
    counts: {
        rows: number;
        accept: number;
        unsure: number;
        reject: number;
        tierDEvict: number;
        agentEvict: number;
        overlap: number;
    };
}

/**
 * Reconcile agent verdicts against the exact row set that was dumped, then build the
 * evict list. Every failure mode below was chosen because it can happen QUIETLY.
 */
export function reconcile(
    rows: Pick<ScreenRow, 'key'>[],
    verdicts: AgentVerdict[],
    tierDEvictKeys: string[],
    tierDVerdicts?: Pick<Verdict, 'key' | 'tierD'>[],
): Reconcile {
    const reasons: string[] = [];

    // --- 1. Coverage: exactly one verdict per row, at the right index.
    const byIdx = new Map<number, AgentVerdict[]>();
    for (const v of verdicts) {
        const list = byIdx.get(v.idx);
        if (list) list.push(v); else byIdx.set(v.idx, [v]);
    }
    const missing: number[] = [];
    const duplicated: number[] = [];
    const misaligned: string[] = [];
    for (let i = 0; i < rows.length; i++) {
        const got = byIdx.get(i);
        if (!got || got.length === 0) { missing.push(i); continue; }
        if (got.length > 1) duplicated.push(i);
        // idx AND key must agree. An off-by-one in a fan-out driver produces a full
        // set of verdicts attached to the wrong rows, which coverage counting alone
        // cannot see — every row is judged, just not the one it says.
        for (const v of got) {
            if (v.key !== rows[i].key) {
                misaligned.push(`idx ${i}: card key "${rows[i].key}" but verdict carries "${v.key}"`);
            }
        }
    }
    const stray = [...byIdx.keys()].filter(i => i < 0 || i >= rows.length);

    if (missing.length) {
        reasons.push(`MISSING ${missing.length} of ${rows.length} verdict(s) — expected one per row, `
            + `observed none for idx ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', ...' : ''}. `
            + 'A short verdict set silently KEEPS every row the dead agent would have flagged.');
    }
    if (duplicated.length) {
        reasons.push(`DUPLICATE verdicts for idx ${duplicated.slice(0, 10).join(', ')}`
            + `${duplicated.length > 10 ? ', ...' : ''} — a batch file was judged twice and the totals are `
            + 'inflated by an unknown amount.');
    }
    if (misaligned.length) {
        reasons.push(`MISALIGNED ${misaligned.length} verdict(s): ${misaligned.slice(0, 5).join(' | ')}`
            + `${misaligned.length > 5 ? ' | ...' : ''}. The fleet judged rows other than the ones named.`);
    }
    if (stray.length) {
        reasons.push(`OUT-OF-RANGE idx ${stray.slice(0, 10).join(', ')} for a ${rows.length}-row dump — `
            + 'these verdicts belong to a different dump.');
    }

    // --- 2. Shape: an unrecognised verdict must not fall through as "not a REJECT".
    const errored = verdicts.filter(v => v.error);
    if (errored.length) {
        reasons.push(`${errored.length} verdict(s) carry an error field (e.g. idx ${errored[0].idx}: `
            + `${JSON.stringify(String(errored[0].error).slice(0, 80))}). A failed judgement is not an ACCEPT.`);
    }
    const badVerdict = verdicts.filter(v => !VALID_VERDICTS.has(v.verdict));
    if (badVerdict.length) {
        reasons.push(`${badVerdict.length} verdict(s) are not ACCEPT/UNSURE/REJECT `
            + `(e.g. idx ${badVerdict[0].idx}: ${JSON.stringify(badVerdict[0].verdict)}). An unrecognised value `
            + 'would default to "keep", which is a decision nobody made.');
    }
    const badAxis = verdicts.filter(v => VALID_VERDICTS.has(v.verdict) && !VALID_AXES.has(v.axis));
    if (badAxis.length) {
        reasons.push(`${badAxis.length} verdict(s) carry an axis outside identity/nutrition/serving/key/none `
            + `(e.g. idx ${badAxis[0].idx}: ${JSON.stringify(badAxis[0].axis)}). The serving-axis exclusion is `
            + 'applied by matching this field, so an unknown axis could smuggle a serving reject into a DELETE.');
    }

    // --- 3. Tier-D evictions must rest on a rule that is allowed to evict.
    const rowKeys = new Set(rows.map(r => r.key));
    const tierDStray = tierDEvictKeys.filter(k => !rowKeys.has(k));
    if (tierDStray.length) {
        reasons.push(`Tier D flagged ${tierDStray.length} key(s) that are not in the row dump `
            + `(${tierDStray.slice(0, 5).join(', ')}) — the two inputs are from different runs.`);
    }
    if (tierDVerdicts) {
        const hits = new Map(tierDVerdicts.map(v => [v.key, v.tierD]));
        const restsOnDemoted: string[] = [];
        for (const k of tierDEvictKeys) {
            const h = hits.get(k);
            if (!h) continue;
            const evicting = h.filter(x => x.severity === 'EVICT').map(x => x.rule);
            if (evicting.length && evicting.every(r => NON_EVICTING_RULES.has(r))) {
                restsOnDemoted.push(`${k} (${evicting.join(',')})`);
            }
        }
        if (restsOnDemoted.length) {
            reasons.push(`${restsOnDemoted.length} Tier-D eviction(s) rest ONLY on rules demoted for cause `
                + `(D1 false-evicts at 73.8% on the live cache; D5/D6 are serving-stage defects a delete cannot fix): `
                + `${restsOnDemoted.slice(0, 5).join(', ')}. Run the agent path at --policy balanced.`);
        }
    }

    if (reasons.length) return { ok: false, reasons };

    // --- 4. Build the list. Only reached when the fleet accounts for the batch.
    const rejects = verdicts.filter(v => v.verdict === 'REJECT');
    const servingAxisRejects = rejects.filter(v => v.axis === 'serving').map(v => v.key);
    const agentEvict = rejects.filter(v => v.axis !== 'serving').map(v => v.key);
    const tierD = new Set(tierDEvictKeys);
    const union = new Set<string>([...tierD, ...agentEvict]);
    // Deterministic order: same inputs, same file, so a diff between two runs is a
    // real difference and not a set-iteration artefact.
    const evict = [...union].sort();

    return {
        ok: true,
        result: {
            evict,
            servingAxisRejects: [...new Set(servingAxisRejects)].sort(),
            counts: {
                rows: rows.length,
                accept: verdicts.filter(v => v.verdict === 'ACCEPT').length,
                unsure: verdicts.filter(v => v.verdict === 'UNSURE').length,
                reject: rejects.length,
                tierDEvict: tierD.size,
                agentEvict: new Set(agentEvict).size,
                overlap: agentEvict.filter(k => tierD.has(k)).length,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function readJson<T>(p: string): T {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function main(): number {
    const args = process.argv.slice(2);
    const val = (flag: string): string | undefined => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    const rowsPath = val('--rows');
    const verdictsPath = val('--verdicts');
    const tierDEvictPath = val('--tier-d-evict');
    const tierDJsonPath = val('--tier-d-json');
    const outPath = val('--out');
    const reportPath = val('--report');
    if (!rowsPath || !verdictsPath || !outPath) {
        console.error('usage: _agent_screen_reconcile.ts --rows <rows.json> --verdicts <agent-verdicts.json> '
            + '--out <screen-evict.txt> [--tier-d-evict <screen-d-evict.txt>] [--tier-d-json <screen-d.json>] '
            + '[--report <reconcile.json>]');
        return 2;
    }

    const rows = readJson<ScreenRow[]>(rowsPath);
    if (!Array.isArray(rows) || rows.length === 0) {
        console.error(`REFUSING: ${rowsPath} holds ${Array.isArray(rows) ? 0 : 'no'} row(s). A screen over zero rows `
            + 'is not a clean batch.');
        return 2;
    }

    const rawVerdicts = readJson<unknown>(verdictsPath);
    // Accept either a bare array or {verdicts:[...]}, because both shapes come back
    // from a fan-out depending on how the session assembled them. Anything else is
    // refused rather than coerced.
    const verdicts: AgentVerdict[] = Array.isArray(rawVerdicts)
        ? rawVerdicts as AgentVerdict[]
        : ((rawVerdicts as { verdicts?: AgentVerdict[] })?.verdicts ?? null) as AgentVerdict[];
    if (!Array.isArray(verdicts)) {
        console.error(`REFUSING: ${verdictsPath} is neither an array of verdicts nor {"verdicts":[...]}.`);
        return 2;
    }

    let tierDEvictKeys: string[] = [];
    if (tierDEvictPath) {
        if (!fs.existsSync(tierDEvictPath)) {
            // Tier D writes this file whenever --out was passed, empty when it flagged
            // nothing. Absent means the screen did not get that far.
            console.error(`REFUSING: --tier-d-evict ${tierDEvictPath} does not exist. Tier D writes this file `
                + 'even when it flags nothing, so an absent file means the Tier-D screen did not complete.');
            return 2;
        }
        tierDEvictKeys = fs.readFileSync(tierDEvictPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    }
    const tierDVerdicts = tierDJsonPath && fs.existsSync(tierDJsonPath)
        ? readJson<{ verdicts: Verdict[] }>(tierDJsonPath).verdicts
        : undefined;

    const r = reconcile(rows, verdicts, tierDEvictKeys, tierDVerdicts);
    if (!r.ok) {
        // Remove any evict file a PREVIOUS attempt left behind. Refusing while a stale
        // list sits at the path the caller reads is the fail-open shape this whole
        // script exists to avoid: a second run's refusal would look like a first run's
        // verdict, and the DELETE would be built from verdicts nobody re-checked.
        if (fs.existsSync(outPath)) {
            fs.unlinkSync(outPath);
            console.error(`(removed a stale ${outPath} from an earlier attempt)`);
        }
        console.error('\nRECONCILE REFUSED — nothing written. The fleet does not account for this batch:\n');
        for (const reason of r.reasons) console.error(`  * ${reason}`);
        console.error('');
        return 2;
    }

    const { evict, servingAxisRejects, counts } = r.result;
    fs.writeFileSync(outPath, evict.join('\n') + (evict.length ? '\n' : ''));
    if (reportPath) {
        fs.writeFileSync(reportPath, JSON.stringify({ ...counts, evict, servingAxisRejects }, null, 1));
    }

    console.log(`reconciled ${counts.rows} row(s): ACCEPT ${counts.accept} · UNSURE ${counts.unsure} · REJECT ${counts.reject}`);
    console.log(`  0 missing, 0 duplicate, 0 misaligned, 0 failed — the fleet accounts for every row.`);
    console.log(`evict = Tier-D ${counts.tierDEvict} u agent ${counts.agentEvict} (overlap ${counts.overlap}) = ${evict.length}`);
    if (servingAxisRejects.length) {
        console.log(`held back ${servingAxisRejects.length} serving-axis REJECT(s) — deleting an identity-only row `
            + `cannot fix a serving weight: ${servingAxisRejects.slice(0, 6).join(', ')}`);
    }
    console.log(`UNSURE rows are NOT evicted; they are the human queue for this batch.`);
    console.log(`wrote ${outPath}${reportPath ? ` and ${reportPath}` : ''}`);

    return evict.length ? 1 : 0;
}

if (require.main === module) {
    try {
        process.exit(main());
    } catch (e) {
        console.error(e);
        process.exit(2);
    }
}
