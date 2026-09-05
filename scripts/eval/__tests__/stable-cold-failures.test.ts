/**
 * stable-cold-failures.test.ts — FAIL INJECTION for the stable-cold-failures
 * checker.
 *
 * Same contract as fail-open-sweep.test.ts and fail-closed.test.ts: this
 * instrument's desirable answer is "no new members", so every block FORCES a
 * way of producing that answer without having measured anything and asserts
 * the verdict VOIDS instead; and every block carries a POSITIVE CONTROL,
 * because "never green" is satisfiable by an instrument that never passes
 * anything (playbook §5).
 *
 * The named holes, per the house rule that an instrument must be shown to void
 * on garbage rather than merely to pass on good input:
 *   - a MISSING results file
 *   - an UNPARSEABLE results file
 *   - a results file with ZERO cases
 *   - a results file from a WARM run — the wrong instrument entirely, and the
 *     single most likely misuse, since the nightly's receipts are warm and sit
 *     in the same results/ directory this script's locator scans
 *   - an EMPTY or malformed roster (reports "no new members" about nothing)
 *   - a filtered run that executed NONE of the roster
 *
 * Plus the naming invariant that is half the point of the artifact: the report
 * must never emit a bare count, and must say out loud that it is not the
 * nightly's "known issues" line.
 *
 * NO NETWORK, NO DATABASE: judgeColdFailureSet is pure; the IO helpers are
 * exercised against real temp dirs.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    ColdRunEvidence,
    ColdSetRoster,
    INSTRUMENT_LABEL,
    coldSetExitCode,
    formatColdSetReport,
    judgeColdFailureSet,
    loadRoster,
    readColdRunEvidence,
} from '../check-stable-cold-failures';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stable-cold-failures-'));

const NINE = [
    'n-cook-03', 'n-mod-02', 'n-mq-30', 'n-mq-41', 'n-prod-01',
    'n-prot-02', 'n-serv-39', 'n-serv-45', 'n-serv-55',
];
const ROTATORS = ['n-brand-02', 'n-serv-26', 'n-svd-03'];

const roster = (over: Partial<ColdSetRoster> = {}): ColdSetRoster => ({
    members: NINE.map(id => ({ id, reason: 'pinned' })),
    rotators: ROTATORS.map(id => ({ id, reason: 'flaps' })),
    ...over,
});

const passCase = (id: string) => ({ id, query: id, detail: '', pass: true });
const failCase = (id: string) => ({ id, query: id, detail: 'band violated', pass: false });
/** A failing case that is EXCUSED — the other instrument's population. */
const knownFail = (id: string) => ({ id, query: id, detail: 'band violated', pass: false, knownIssue: true });

/** A clean cold receipt: the nine fail, a rotator flaps, everything else passes. */
const coldEvidence = (over: Partial<ColdRunEvidence> = {}, results?: unknown[]): ColdRunEvidence => ({
    resultsFile: '/x/results/eval-2026-08-19T20-32-13-013Z.json',
    data: {
        summary: { noCache: true, buildId: 'i1BDbnq_b8pC7Hm3gD_bM', ranAt: '2026-08-19T20:32:13Z' },
        results: results ?? [
            ...NINE.map(failCase),
            failCase('n-svd-03'),
            passCase('n-gen-01'), passCase('n-gen-02'), passCase('n-brand-02'), passCase('n-serv-26'),
        ],
    },
    ...over,
});

// ===========================================================================
// 0. POSITIVE CONTROL — the instrument can say yes
// ===========================================================================

describe('POSITIVE CONTROL: a real cold run matching the roster is clean', () => {
    it('confirms all nine, flags no new members, exits 0', () => {
        const v = judgeColdFailureSet(coldEvidence(), roster());
        expect(v.error).toBeUndefined();
        expect(v.ran).toBe(true);
        expect(v.ok).toBe(true);
        expect(v.confirmed.sort()).toEqual([...NINE].sort());
        expect(v.newMembers).toEqual([]);
        expect(v.leftTheSet).toEqual([]);
        expect(v.partial).toBe(false);
        expect(coldSetExitCode(v)).toBe(0);
    });

    it('a documented rotator failing is reported as a rotator, NOT a new member', () => {
        const v = judgeColdFailureSet(coldEvidence(), roster());
        expect(v.rotatorsPresent).toEqual(['n-svd-03']);
        expect(v.newMembers).toEqual([]);
        expect(v.ok).toBe(true);
    });

    it('all three rotators failing at once is still clean — that is what "expected to flap" means', () => {
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.map(failCase), ...ROTATORS.map(failCase), passCase('n-gen-01')]),
            roster());
        expect(v.rotatorsPresent.sort()).toEqual([...ROTATORS].sort());
        expect(v.ok).toBe(true);
        expect(coldSetExitCode(v)).toBe(0);
    });
});

// ===========================================================================
// 1. The two findings this instrument exists to produce
// ===========================================================================

describe('the transition the prose missed: NEW MEMBER and LEFT THE SET', () => {
    it('NEW MEMBER: a hard cold failure absent from the roster is reported and exits 1', () => {
        // 2026-08-18T23:20Z, verbatim: n-dens-07 joined and nothing noticed.
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.map(failCase), failCase('n-dens-07'), passCase('n-gen-01')]),
            roster());
        expect(v.newMembers.map(m => m.id)).toEqual(['n-dens-07']);
        expect(v.ok).toBe(false);
        expect(coldSetExitCode(v)).toBe(1);
        expect(formatColdSetReport(v).join('\n')).toContain('NEW MEMBER');
    });

    it('LEFT THE SET: a roster member that PASSED is reported and exits 1', () => {
        // 2026-08-19T20:25Z: n-dens-07 left after the re-band. Here, n-mq-41.
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.filter(id => id !== 'n-mq-41').map(failCase), passCase('n-mq-41')]),
            roster());
        expect(v.leftTheSet).toEqual(['n-mq-41']);
        expect(v.ok).toBe(false);
        expect(coldSetExitCode(v)).toBe(1);
        expect(formatColdSetReport(v).join('\n')).toContain('LEFT THE SET');
    });

    it('an EXCUSED (knownIssue) cold failure is never a new member — that is the other instrument', () => {
        // The whole naming problem in one assertion: knownIssue failures belong
        // to the nightly's count, and must not leak into this set.
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.map(failCase), knownFail('n-prose-01'), knownFail('n-mq-27')]),
            roster());
        expect(v.newMembers).toEqual([]);
        expect(v.ok).toBe(true);
    });

    it('a case that is ABSENT from the results has NOT left the set — absent is not passing', () => {
        // A --grep run must never retire a member it never executed.
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.filter(id => id !== 'n-mq-41').map(failCase), passCase('n-gen-01')]),
            roster());
        expect(v.leftTheSet).toEqual([]);
        expect(v.notRun).toEqual(['n-mq-41']);
        expect(v.partial).toBe(true);
        expect(formatColdSetReport(v).join('\n')).toContain('PARTIAL');
    });
});

// ===========================================================================
// 2. FAIL INJECTION — every way of reporting "no new members" without measuring
// ===========================================================================

describe('VOID: the instrument refuses to report "no new members" on garbage', () => {
    const assertVoid = (v: ReturnType<typeof judgeColdFailureSet>, fragment: string) => {
        expect(v.ran).toBe(false);
        expect(v.ok).toBe(false);
        expect(v.newMembers).toEqual([]);
        expect(v.error).toBeDefined();
        expect(v.error).toContain(fragment);
        expect(coldSetExitCode(v)).toBe(2);
        // and the report must not be readable as a clean bill
        const report = formatColdSetReport(v).join('\n');
        expect(report).toContain('INSTRUMENT FAILURE');
        expect(report).not.toContain('unchanged');
    };

    it('a MISSING results file voids', () => {
        assertVoid(judgeColdFailureSet({ resultsFile: null }, roster()), 'no cold results file');
    });

    it('an UNPARSEABLE results file voids', () => {
        assertVoid(
            judgeColdFailureSet(coldEvidence({ parseError: 'Unexpected end of JSON input', data: null }), roster()),
            'unreadable');
    });

    it('ZERO cases voids — a run that evaluated nothing has no verdict', () => {
        // The exact shape run-eval leaves behind on its exit-2 path: it writes
        // the file first, so `results: []` is a real file on disk, and "no
        // failures therefore no new members" is the false green to refuse.
        assertVoid(judgeColdFailureSet(coldEvidence({}, []), roster()), 'ZERO cases');
    });

    it('THE WRONG-INSTRUMENT CASE: a WARM results file voids, however green it looks', () => {
        // The nightly's warm receipts land in the same results/ directory the
        // locator scans, so this is the likeliest misuse. A warm run resolves
        // most nlp cases from cache; its failures say nothing about the cold set.
        const warm = coldEvidence();
        warm.data!.summary!.noCache = false;
        const v = judgeColdFailureSet(warm, roster());
        assertVoid(v, 'WRONG INSTRUMENT');
        expect(v.error).toContain('WARM');
    });

    it('a WARM file whose failures EXACTLY match the roster still voids', () => {
        // Being right by accident is not being measured. The refusal must be on
        // the run's kind, before its contents are looked at at all.
        const warm = coldEvidence({}, [...NINE.map(failCase), passCase('n-gen-01')]);
        warm.data!.summary!.noCache = false;
        assertVoid(judgeColdFailureSet(warm, roster()), 'WRONG INSTRUMENT');
    });

    it('a results file with NO summary voids — warm and cold are indistinguishable in it', () => {
        assertVoid(
            judgeColdFailureSet({ resultsFile: '/x/eval-1.json', data: { results: NINE.map(failCase) } }, roster()),
            'no summary');
    });

    it('summary.noCache ABSENT voids — an older receipt that predates the flag is not a cold receipt', () => {
        assertVoid(
            judgeColdFailureSet(
                { resultsFile: '/x/eval-1.json', data: { summary: { buildId: 'b' }, results: NINE.map(failCase) } },
                roster()),
            'WRONG INSTRUMENT');
    });

    it('a MISSING roster voids — not "zero members, therefore nothing new"', () => {
        assertVoid(judgeColdFailureSet(coldEvidence(), null), 'missing or malformed');
    });

    it('an EMPTY roster voids — it would report clean for every run forever', () => {
        assertVoid(judgeColdFailureSet(coldEvidence(), { members: [] }), 'ZERO members');
    });

    it('a malformed roster (members not an array) voids', () => {
        assertVoid(
            judgeColdFailureSet(coldEvidence(), { members: 'n-mq-41' as unknown as ColdSetRoster['members'] }),
            'missing or malformed');
    });

    it('a roster whose members carry no ids voids', () => {
        assertVoid(judgeColdFailureSet(coldEvidence(), { members: [{ reason: 'x' } as never, {} as never] }), 'ZERO members');
    });

    it('a run that executed NONE of the roster voids — a filter is not a clean bill', () => {
        const v = judgeColdFailureSet(
            coldEvidence({}, [passCase('s-gen-01'), passCase('s-gen-02'), passCase('s-gen-03')]),
            roster());
        assertVoid(v, 'executed NONE');
        expect(v.casesRun).toBe(3);
    });

    it('the roster is judged BEFORE the run: a broken roster voids even on a perfect cold receipt', () => {
        const v = judgeColdFailureSet(coldEvidence(), { members: [] });
        expect(v.error).toContain('ZERO members');
        expect(v.error).not.toContain('WRONG INSTRUMENT');
    });

    it('coldness is judged BEFORE contents: a warm run with zero cases reports the warm problem', () => {
        const warm = coldEvidence({}, []);
        warm.data!.summary!.noCache = false;
        expect(judgeColdFailureSet(warm, roster()).error).toContain('WRONG INSTRUMENT');
    });
});

// ===========================================================================
// 3. THE NAMING FIX — the output must be self-identifying, never a bare count
// ===========================================================================

describe('naming: this instrument never reads as the nightly\'s "known issues" line', () => {
    it('every reported line carries the instrument name', () => {
        const v = judgeColdFailureSet(
            coldEvidence({}, [...NINE.map(failCase), failCase('n-dens-07'), passCase('n-gen-01')]),
            roster());
        const findings = formatColdSetReport(v).filter(l => /NEW MEMBER|LEFT THE SET|confirmed still failing|rotators/.test(l));
        expect(findings.length).toBeGreaterThan(0);
        for (const line of findings) expect(line).toContain(INSTRUMENT_LABEL);
    });

    it('the header disclaims the nightly\'s number explicitly', () => {
        const report = formatColdSetReport(judgeColdFailureSet(coldEvidence(), roster())).join('\n');
        expect(report).toContain('STABLE COLD FAILURES');
        expect(report).toContain('known issues');
        expect(report).toContain('WARM');
        expect(report).toMatch(/NOT the nightly/);
    });

    it('the verdict object identifies its own instrument, so a caller cannot mix the two up', () => {
        expect(judgeColdFailureSet(coldEvidence(), roster()).instrument).toBe('stable-cold-failures');
        expect(judgeColdFailureSet({ resultsFile: null }, roster()).instrument).toBe('stable-cold-failures');
    });
});

// ===========================================================================
// 4. IO helpers — the locator and the roster reader must fail the same way
// ===========================================================================

describe('IO: loadRoster / readColdRunEvidence surface absence rather than inventing emptiness', () => {
    it('loadRoster returns null (not an empty roster) for a missing or corrupt file', () => {
        const dir = tmpDir();
        expect(loadRoster(path.join(dir, 'nope.json'))).toBeNull();
        const bad = path.join(dir, 'bad.json');
        fs.writeFileSync(bad, '{ not json');
        expect(loadRoster(bad)).toBeNull();
        // and null is what the verdict voids on
        expect(judgeColdFailureSet(coldEvidence(), loadRoster(bad)).error).toContain('missing or malformed');
    });

    it('loadRoster reads the REAL shipped roster and it satisfies the verdict', () => {
        const real = loadRoster();
        expect(real).not.toBeNull();
        // The REAL membership, pinned on purpose: editing stable-cold-failures.json
        // means editing this line with the receipt. Stated explicitly rather than
        // derived from the NINE fixture above — that fixture is synthetic input for
        // the checker's own logic and still carries n-mq-30, which LEFT THE SET on
        // 2026-08-24 (PASSED 3/3 restarted cold runs on qwm6HGP465bEqu0Upz5_l after
        // backend #381 stopped rewriting `bell pepper` into `capsicum`; recorded
        // under `departed` in the roster file).
        //
        // n-serv-21 JOINED 2026-08-27 (Diego decision D2), confirmed on
        // T_pVsW6iVzKDqE_E9Y8OE immediately after the #391 + #392 deploy. It is
        // COLD-ONLY, warm-protected by an existing cache row, and carries its
        // mechanism in the roster file's own `reason`.
        //
        // n-serv-57 joined with it and LEFT 2026-08-28, fixed by backend #398 (A25):
        // getCategoryChangePenalty() now charges the unmatched SHARE of a candidate's
        // in-set tokens, so the Kirkland protein bars stop paying full price for
        // `cookie`. Confirmed PASSING 3/3 on restarted cold runs on
        // sGg_Kx8wKgMGPR53tnEPF at 60 g / 220.2 kcal, and recorded under `departed`
        // in the roster file. This list moves with that file on purpose: the pin is
        // the double entry that stops a membership change from being silent, which is
        // the ten-that-became-a-nine this whole instrument exists to prevent.
        const REAL_MEMBERS = [
            'n-cook-03', 'n-mod-02', 'n-mq-41', 'n-prod-01', 'n-prot-02',
            'n-serv-21', 'n-serv-39', 'n-serv-45', 'n-serv-55',
        ];
        expect(real!.members.map(m => m.id).sort()).toEqual([...REAL_MEMBERS].sort());
        const results = [
            ...REAL_MEMBERS.map(failCase),
            failCase('n-svd-03'),
            passCase('n-gen-01'), passCase('n-mq-30'), passCase('n-brand-02'), passCase('n-serv-26'),
        ];
        const v = judgeColdFailureSet(coldEvidence({}, results), real);
        expect(v.error).toBeUndefined();
        expect(v.ok).toBe(true);
        expect(v.confirmed.sort()).toEqual([...REAL_MEMBERS].sort());
    });

    // n-prot-04 IS NOT MEMBER #10, and this pin is why.
    //
    // `100g black beans` is a five-way retrieval tie. Census over the 359 full runs
    // in scripts/eval/results/ (2026-09-04): off_9310175104092 x94, fs_46836 x83,
    // off_9339337310782 x80 and fs_6673141 x30 all PASS; only off_7896006712398 (x6)
    // fails, at protein100=4.0 against [5, 25]. 6 of 293 resolved runs = 2.0%.
    //
    // The six failures sit in exactly two triplets (2026-08-11T21:3x and
    // 2026-09-04T01:3x) because the tie re-rolls on a full Typesense REBUILD, not on
    // a restart -- so within one build it is parked on one side and three restarted
    // runs read a clean 3/3. That is a blind spot in this instrument's own
    // membership method, and it has now produced the same wrong proposal twice.
    // Putting it in `members` would make the detector print LEFT THE SET at the next
    // rebuild and invite someone to attribute a fix that never happened.
    it('keeps n-prot-04 in rotators, never in members', () => {
        const real = loadRoster();
        expect(real).not.toBeNull();
        const memberIds = real!.members.map(m => m.id);
        const rotatorIds = (real!.rotators ?? []).map(r => r.id);
        expect(memberIds).not.toContain('n-prot-04');
        expect(rotatorIds).toContain('n-prot-04');

        // and the detector must treat it as expected, not as a new member
        const results = [
            ...memberIds.map(failCase),
            failCase('n-prot-04'),
            passCase('n-gen-01'),
        ];
        const v = judgeColdFailureSet(coldEvidence({}, results), real!);
        expect(v.error).toBeUndefined();
        expect(v.newMembers).toEqual([]);
        expect(v.leftTheSet).toEqual([]);
        expect(v.rotatorsPresent).toContain('n-prot-04');
        expect(v.ok).toBe(true);
    });

    it('readColdRunEvidence reports no file rather than throwing when results/ is absent or empty', () => {
        const dir = tmpDir();
        expect(readColdRunEvidence(undefined, path.join(dir, 'missing')).resultsFile).toBeNull();
        expect(readColdRunEvidence(undefined, dir).resultsFile).toBeNull();
    });

    it('readColdRunEvidence picks the NEWEST eval-*.json and ignores other files', () => {
        const dir = tmpDir();
        const write = (name: string, body: unknown, mtime: number) => {
            const p = path.join(dir, name);
            fs.writeFileSync(p, JSON.stringify(body));
            fs.utimesSync(p, mtime / 1000, mtime / 1000);
            return p;
        };
        write('eval-old.json', { summary: { noCache: true }, results: [failCase('n-mq-41')] }, Date.now() - 100_000);
        const newest = write('eval-new.json', { summary: { noCache: true }, results: NINE.map(failCase) }, Date.now());
        write('stuck-keys-2026.json', { results: [] }, Date.now() + 100_000);
        expect(readColdRunEvidence(undefined, dir).resultsFile).toBe(newest);
    });

    it('readColdRunEvidence surfaces a parse error instead of an empty result set', () => {
        const dir = tmpDir();
        fs.writeFileSync(path.join(dir, 'eval-broken.json'), '{"summary": {"noCache": true}, "results": [');
        const ev = readColdRunEvidence(undefined, dir);
        expect(ev.parseError).toBeDefined();
        expect(judgeColdFailureSet(ev, roster()).error).toContain('unreadable');
    });

    it('an explicitly named file that does not exist reports no file, not a crash', () => {
        expect(readColdRunEvidence(path.join(tmpDir(), 'eval-gone.json')).resultsFile).toBeNull();
    });
});
