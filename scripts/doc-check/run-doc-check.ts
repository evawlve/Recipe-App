/**
 * run-doc-check.ts — execute every claim in claims.json against the real system.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only scripts/doc-check/run-doc-check.ts \
 *       [--only <id-substring>] [--where backend,box] [--list]
 *
 * --where restricts to claim contexts, for hosts that cannot reach every context:
 * the OptiPlex has no copy of the mobile repo (verified 2026-07-30 — no Syncthing
 * share carries it), so its nightly run uses --where backend,box. The exclusion is
 * LOUD: every out-of-scope claim is counted in the output, because a silent cap
 * reads as "covered everything" when it didn't. Full coverage runs from the Mac,
 * where ssh reaches the box.
 *
 * Exit codes (see checkerExitCode): 0 all claims hold; 1 at least one claim is now
 * FALSE or could not be checked; 2 the run is not a result (empty registry, filter
 * matched nothing). Wire into the nightly sweep so doc rot is reported before anyone
 * builds on it, instead of discovered mid-implementation.
 *
 * This file is deliberately THIN. All verdict logic lives in doc-check-core.ts where
 * the fail-closed tests can import it; anything added here is code the tests cannot
 * see (the run-eval.ts lesson — a tested predicate wired into an untested verdict).
 *
 * CONTEXTS
 *   backend — this repo's root.
 *   mobile  — the KindaHealthyMobile repo's FILES. Since 2026-07-30 Syncthing
 *             delivers them to the box too (folder msmwx-9fkha, receive-only,
 *             ignoring ios/android/node_modules); resolved via
 *             DOC_CHECK_MOBILE_ROOT or the known per-machine paths.
 *   devmachine — the mobile repo PLUS an installed toolchain. node_modules is
 *             Syncthing-ignored, so `npx tsc` does not exist on the box. These
 *             claims are out of scope there and are reported as such, never
 *             silently dropped.
 *   box     — the OptiPlex. Local when this host IS the box, ssh otherwise.
 *             A dead ssh FAILS those claims (never skips): the box being
 *             unreachable is exactly when its state is least verified.
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { hostname } from 'os';
import { join, resolve } from 'path';
import { checkerExitCode, evaluateClaim, parseRegistry, type ClaimContext, type CommandOutcome, type DocClaim } from './doc-check-core';

const BACKEND_ROOT = resolve(__dirname, '..', '..');
const BOX_HOSTNAME = 'DHL32-Opt-5060';
const BOX_SSH = 'owner@192.168.1.133';
const DEFAULT_TIMEOUT_MS = 120_000;

const MOBILE_CANDIDATES = [
    process.env.DOC_CHECK_MOBILE_ROOT ?? '',
    '/Users/diego/dev/KindaHealthyMobile',
    // Pre-2026-08-13 Mac location, under ~/Documents (an iCloud file-provider domain). Kept so a
    // machine that has not been migrated still resolves; safe to drop once none remain.
    '/Users/diego/Documents/Github/KindaHealthyMobile/KindaHealthyMobile',
    '/home/owner/KindaHealthyMobile',
].filter(Boolean);

function mobileRoot(): string | null {
    for (const p of MOBILE_CANDIDATES) {
        if (existsSync(join(p, 'CLAUDE.md'))) return p;
    }
    return null;
}

function onBox(): boolean {
    return hostname() === BOX_HOSTNAME;
}

function runCommand(c: DocClaim): CommandOutcome {
    const timeout = c.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let argv: string[];
    let cwd = BACKEND_ROOT;

    if (c.where === 'mobile' || c.where === 'devmachine') {
        const root = mobileRoot();
        if (!root) {
            return { ran: false, stdout: '', exitCode: null, error: 'mobile repo not found (set DOC_CHECK_MOBILE_ROOT)' };
        }
        cwd = root;
        argv = ['sh', '-c', c.command];
    } else if (c.where === 'box' && !onBox()) {
        // BatchMode so a missing key fails fast instead of hanging on a prompt.
        argv = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', BOX_SSH, c.command];
    } else {
        argv = ['sh', '-c', c.command];
    }

    const res = spawnSync(argv[0], argv.slice(1), { cwd, timeout, encoding: 'utf8' });
    if (res.error) {
        return { ran: false, stdout: '', exitCode: null, error: String(res.error) };
    }
    // ssh's own transport failures exit 255 with nothing useful on stdout — that is
    // "could not run", not "ran and produced a wrong value".
    if (c.where === 'box' && !onBox() && res.status === 255) {
        return { ran: false, stdout: '', exitCode: 255, error: `ssh transport failure: ${(res.stderr ?? '').trim().slice(0, 200)}` };
    }
    return { ran: true, stdout: res.stdout ?? '', exitCode: res.status };
}

function main(): void {
    const args = process.argv.slice(2);
    const onlyIx = args.indexOf('--only');
    const only = onlyIx >= 0 ? args[onlyIx + 1] : null;
    const whereIx = args.indexOf('--where');
    const where = whereIx >= 0 ? new Set(args[whereIx + 1].split(',')) : null;

    const registryPath = join(__dirname, 'claims.json');
    let claims: DocClaim[];
    try {
        claims = parseRegistry(readFileSync(registryPath, 'utf8'));
    } catch (e) {
        console.error(`doc-check: registry unusable — ${(e as Error).message}`);
        process.exit(2);
        return;
    }

    let selected = only ? claims.filter(c => c.id.includes(only)) : claims;
    if (where) {
        const excluded = selected.filter(c => !where.has(c.where));
        selected = selected.filter(c => where.has(c.where));
        if (excluded.length) {
            console.log(`doc-check: ${excluded.length} claim(s) OUT OF SCOPE for --where ${[...where].join(',')}: ${excluded.map(c => c.id).join(', ')}`);
        }
    }

    if (args.includes('--list')) {
        for (const c of selected) console.log(`${c.id}  [${c.where}]  (verified ${c.verified})  ${c.ownerDoc}`);
        // --list is an inspection, not a run; still refuse to pretend an empty
        // selection is fine.
        process.exit(selected.length === 0 ? 2 : 0);
        return;
    }

    const results = selected.map(c => {
        const r = evaluateClaim(c, runCommand(c));
        console.log(`${r.pass ? '✅' : '❌'} ${r.id}: ${r.detail}${r.pass ? '' : `\n   claim: ${c.claim}\n   owner: ${r.ownerDoc}\n   rerun: ${c.command}`}`);
        return r;
    });

    const failed = results.filter(r => !r.pass);
    const code = checkerExitCode(results);
    if (code === 2) {
        console.error(`doc-check: 0 claims ran${only ? ` (--only "${only}" matched nothing)` : ''} — not a result`);
    } else {
        console.log(`\ndoc-check: ${results.length - failed.length}/${results.length} claims hold${failed.length ? ` — ${failed.length} FALSE or unrunnable; update the owner doc AND the registry entry together` : ''}`);
    }
    process.exit(code);
}

main();
