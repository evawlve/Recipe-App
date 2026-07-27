/**
 * snapshot-off-food.test.ts — FAIL INJECTION for the OffFood snapshot script
 * (the §4 divided-panel repair's only rollback path).
 *
 * Same contract as fail-closed.test.ts: every fallible boundary is forced to
 * fail and the verdict must be the REFUSING one, with a positive control so
 * "never passes anything" cannot satisfy the suite. The transport (ssh to the
 * DB host) is the single mocked boundary; NO NETWORK, NO DATABASE, NO ssh —
 * nothing in this file talks to a real host.
 *
 * The five injections the snapshot must survive (each maps to a §11 class B
 * incident shape that shipped a confidently wrong number elsewhere):
 *   transport failure            -> refuse, not "0 rows dumped, exit 0"
 *   pg COPY / docker failure     -> refuse, partial never becomes final
 *   count mismatch               -> refuse (truncated dump reads as SHORT, not done)
 *   empty dump / empty count     -> refuse (absence is not zero)
 *   pre-existing output file     -> refuse BEFORE dumping anything
 */

import {
    DEFAULT_CONTAINER,
    DEFAULT_OUT_DIR,
    DEFAULT_SSH_HOST,
    REQUIRED_COLUMNS,
    buildCopySql,
    dbIdentityFromEnv,
    isSafeColumnName,
    measure,
    parseCliArgs,
    parseCount,
    parseLabeled,
    restoreInstructions,
    shellQuote,
    snapshot,
    snapshotPaths,
    timestampToken,
    type ExecResult,
    type SnapshotConfig,
    type Transport,
} from '../snapshot-off-food';

// ===========================================================================
// Harness
// ===========================================================================

type Handler = (script: string) => ExecResult;

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '' });
const fail = (code: number, stderr: string): ExecResult => ({ code, stdout: '', stderr });

class FakeTransport implements Transport {
    calls: { step: string; script: string }[] = [];
    constructor(private handlers: Record<string, Handler>) {}
    exec(step: string, script: string): Promise<ExecResult> {
        this.calls.push({ step, script });
        const h = this.handlers[step];
        if (!h) throw new Error(`FakeTransport: no handler for step '${step}' — the pipeline grew a step the tests do not model`);
        return Promise.resolve(h(script));
    }
    steps(): string[] {
        return this.calls.map(c => c.step);
    }
    script(step: string): string {
        const c = this.calls.find(x => x.step === step);
        if (!c) throw new Error(`step '${step}' never ran`);
        return c.script;
    }
}

/** All 16 live columns, embedding last — mirrors information_schema order. */
const ALL_COLS = [...REQUIRED_COLUMNS, 'embedding'];

const ROWS = 1000;

function happyHandlers(over: Record<string, Handler> = {}, opts: { rows?: number; cols?: number } = {}): Record<string, Handler> {
    const rows = opts.rows ?? ROWS;
    const cols = opts.cols ?? ALL_COLS.length;
    return {
        'transport-preflight': () => ok('SNAPSHOT_TRANSPORT_OK\n'),
        mkdir: () => ok(''),
        'refuse-overwrite': () => ok('ABSENT\n'),
        'discover-columns': () => ok(ALL_COLS.join('\n') + '\n'),
        'count-before': () => ok(`${rows}\n`),
        dump: () => ok(''),
        'verify-integrity': () => ok(`LINES=${rows}\nCOLS=${cols}\nBYTES=987654\nSHA256=deadbeef00\n`),
        'count-after': () => ok(`${rows}\n`),
        finalize: () => ok(''),
        manifest: () => ok(''),
        ...over,
    };
}

function cfg(over: Partial<SnapshotConfig> = {}): SnapshotConfig {
    return {
        sshHost: DEFAULT_SSH_HOST,
        container: DEFAULT_CONTAINER,
        outDir: DEFAULT_OUT_DIR,
        dbUser: 'app',
        dbName: 'recipes',
        excludeEmbedding: false,
        measure: false,
        label: null,
        now: new Date('2026-07-27T12:00:00.000Z'),
        ...over,
    };
}

async function run(handlers: Record<string, Handler>, c: SnapshotConfig = cfg()) {
    const t = new FakeTransport(handlers);
    const logs: string[] = [];
    const code = await snapshot(c, t, s => logs.push(s));
    return { code, t, out: logs.join('\n') };
}

const FULL_ORDER = [
    'transport-preflight', 'mkdir', 'refuse-overwrite', 'discover-columns',
    'count-before', 'dump', 'verify-integrity', 'count-after', 'finalize', 'manifest',
];

// ===========================================================================
// 1. POSITIVE CONTROL — without this, "always refuse" passes every injection
// ===========================================================================

describe('positive control: a clean run succeeds and is complete', () => {
    it('exits 0 and runs every step exactly once, in order', async () => {
        const { code, t } = await run(happyHandlers());
        expect(code).toBe(0);
        expect(t.steps()).toEqual(FULL_ORDER);
    });

    it('the dump is host-side COPY of EVERY required column, ordered, into the .partial name', async () => {
        const { t } = await run(happyHandlers());
        const dump = t.script('dump');
        for (const col of REQUIRED_COLUMNS) expect(dump).toContain(`"${col}"`);
        expect(dump).toContain('"embedding"'); // default = safe complete choice
        expect(dump).toContain('COPY (SELECT');
        expect(dump).toContain('ORDER BY "barcode"');
        expect(dump).toContain('TO STDOUT');
        expect(dump).toContain('set -euo pipefail');
        expect(dump).toContain('gzip -9');
        expect(dump).toContain('.tsv.gz.partial');
        expect(dump).not.toContain('--execute');
    });

    it('the final name only appears at finalize (mv), never as a dump target', async () => {
        const { t } = await run(happyHandlers());
        const paths = snapshotPaths(cfg());
        expect(t.script('dump')).not.toContain(`> ${shellQuote(paths.dataFile)}`);
        const fin = t.script('finalize');
        expect(fin).toContain('mv ');
        expect(fin).toContain(paths.partialFile);
        expect(fin).toContain(paths.dataFile);
    });

    it('prints the per-row restore recipe and the verified numbers', async () => {
        const { out } = await run(happyHandlers());
        expect(out).toContain('SNAPSHOT OK');
        expect(out).toContain(`${ROWS} rows`);
        expect(out).toContain('UPDATE "OffFood" f SET');
        expect(out).toContain('FROM "OffFood_restore" s');
        expect(out).toContain('CREATE TABLE "OffFood_restore" (LIKE "OffFood")');
        expect(out).toContain('sha256:   deadbeef00');
    });

    it('the manifest records rowCount, sha256 and the dumped column list', async () => {
        const { t } = await run(happyHandlers());
        const script = t.script('manifest');
        expect(script).toContain('"rowCount": 1000');
        expect(script).toContain('"sha256": "deadbeef00"');
        expect(script).toContain('"nutrientsPer100g"');
        expect(script).toContain('.meta.json');
    });

    it('--exclude-embedding drops ONLY embedding and marks the filename', async () => {
        const c = cfg({ excludeEmbedding: true });
        const { code, t } = await run(happyHandlers({}, { cols: ALL_COLS.length - 1 }), c);
        expect(code).toBe(0);
        const dump = t.script('dump');
        expect(dump).not.toContain('"embedding"');
        for (const col of REQUIRED_COLUMNS) expect(dump).toContain(`"${col}"`);
        expect(t.script('finalize')).toContain('-noembed.tsv.gz');
    });

    it('the overwrite probe covers final, partial AND manifest names', async () => {
        const { t } = await run(happyHandlers());
        const probe = t.script('refuse-overwrite');
        const paths = snapshotPaths(cfg());
        expect(probe).toContain(paths.dataFile);
        expect(probe).toContain(paths.partialFile);
        expect(probe).toContain(paths.metaFile);
    });
});

// ===========================================================================
// 2. FAIL INJECTION — the five required failures, plus every parse boundary
// ===========================================================================

describe('fail injection: transport', () => {
    it('ssh failure on preflight -> nonzero, nothing else runs', async () => {
        const { code, t, out } = await run(happyHandlers({
            'transport-preflight': () => fail(255, 'ssh: connect to host 192.168.1.133 port 22: No route to host'),
        }));
        expect(code).not.toBe(0);
        expect(t.steps()).toEqual(['transport-preflight']);
        expect(out).toContain('transport-preflight');
        expect(out).toContain('No route to host');
    });

    it('a banner instead of the sentinel is NOT a healthy transport', async () => {
        const { code, out } = await run(happyHandlers({
            'transport-preflight': () => ok('Welcome to Ubuntu 22.04\n'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('SNAPSHOT_TRANSPORT_OK');
    });
});

describe('fail injection: the dump itself', () => {
    it('pg COPY / docker failure -> nonzero, stderr surfaced, partial NEVER becomes final', async () => {
        const { code, t, out } = await run(happyHandlers({
            dump: () => fail(1, 'error: server closed the connection unexpectedly'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('server closed the connection unexpectedly');
        expect(t.steps()).not.toContain('finalize');
        expect(t.steps()).not.toContain('manifest');
        expect(out).toContain('SNAPSHOT REFUSED');
    });

    it('gzip integrity failure -> nonzero, no finalize', async () => {
        const { code, t } = await run(happyHandlers({
            'verify-integrity': () => fail(1, 'gzip: /home/owner/snapshots/x.partial: unexpected end of file'),
        }));
        expect(code).not.toBe(0);
        expect(t.steps()).not.toContain('finalize');
    });
});

describe('fail injection: count verification', () => {
    it('dump lines != count(*) -> nonzero with expected-vs-observed, no finalize', async () => {
        const { code, t, out } = await run(happyHandlers({
            'verify-integrity': () => ok(`LINES=999\nCOLS=${ALL_COLS.length}\nBYTES=987654\nSHA256=deadbeef00\n`),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('1000');
        expect(out).toContain('999');
        expect(t.steps()).not.toContain('finalize');
    });

    it('table moved during the run (count-after drifts) -> nonzero, no finalize', async () => {
        const { code, t, out } = await run(happyHandlers({
            'count-after': () => ok('1001\n'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('moved during the snapshot');
        expect(t.steps()).not.toContain('finalize');
    });

    it('an EMPTY count stdout is unparseable, never zero (§11 class B)', async () => {
        const { code, out } = await run(happyHandlers({ 'count-before': () => ok('') }));
        expect(code).not.toBe(0);
        expect(out).toContain('unparseable');
    });

    it('garbage on the count channel is unparseable, never zero', async () => {
        const { code } = await run(happyHandlers({
            'count-before': () => ok('ERROR:  relation "OffFood" does not exist\n'),
        }));
        expect(code).not.toBe(0);
    });

    it('an empty table is REFUSED — an empty rollback path is fail-open', async () => {
        const { code, t, out } = await run(happyHandlers({ 'count-before': () => ok('0\n') }));
        expect(code).not.toBe(0);
        expect(out).toContain('empty table');
        expect(t.steps()).not.toContain('dump');
    });
});

describe('fail injection: empty or malformed dump file', () => {
    it('an empty dump file -> nonzero even if gzip is intact', async () => {
        const { code, t, out } = await run(happyHandlers({
            'verify-integrity': () => ok(`LINES=0\nCOLS=0\nBYTES=20\nSHA256=deadbeef00\n`),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('EMPTY dump file');
        expect(t.steps()).not.toContain('finalize');
    });

    it('a first row with the wrong field count -> nonzero (dump shape drifted)', async () => {
        const { code, out } = await run(happyHandlers({
            'verify-integrity': () => ok(`LINES=${ROWS}\nCOLS=3\nBYTES=987654\nSHA256=deadbeef00\n`),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain(`${ALL_COLS.length} tab-separated fields`);
    });

    it('missing verify labels -> nonzero (a verifier that reports nothing verified nothing)', async () => {
        const { code } = await run(happyHandlers({
            'verify-integrity': () => ok(`LINES=${ROWS}\nCOLS=${ALL_COLS.length}\n`),
        }));
        expect(code).not.toBe(0);
    });
});

describe('fail injection: refuse-overwrite', () => {
    it('an existing file refuses BEFORE any dump happens', async () => {
        const { code, t, out } = await run(happyHandlers({
            'refuse-overwrite': () => ok('EXISTS\n'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('never overwrites');
        expect(t.steps()).not.toContain('discover-columns');
        expect(t.steps()).not.toContain('dump');
    });

    it('an unrecognized existence verdict refuses (unknown is not ABSENT)', async () => {
        const { code, t } = await run(happyHandlers({
            'refuse-overwrite': () => ok('MAYBE\n'),
        }));
        expect(code).not.toBe(0);
        expect(t.steps()).not.toContain('dump');
    });
});

describe('fail injection: column discovery', () => {
    it('a REQUIRED column missing from the live schema refuses, naming it', async () => {
        const cols = ALL_COLS.filter(c => c !== 'nutrientsPer100g');
        const { code, t, out } = await run(happyHandlers({
            'discover-columns': () => ok(cols.join('\n') + '\n'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('nutrientsPer100g');
        expect(t.steps()).not.toContain('dump');
    });

    it('zero columns (psql emitted nothing) refuses', async () => {
        const { code } = await run(happyHandlers({ 'discover-columns': () => ok('') }));
        expect(code).not.toBe(0);
    });

    it('a column name that could escape SQL quoting refuses', async () => {
        const { code, t } = await run(happyHandlers({
            'discover-columns': () => ok([...ALL_COLS, 'bad"col'].join('\n') + '\n'),
        }));
        expect(code).not.toBe(0);
        expect(t.steps()).not.toContain('dump');
    });
});

describe('fail injection: after a verified dump', () => {
    it('mv failure -> nonzero (a snapshot you cannot name is not a snapshot)', async () => {
        const { code, t } = await run(happyHandlers({
            finalize: () => fail(1, 'mv: cannot move: Permission denied'),
        }));
        expect(code).not.toBe(0);
        expect(t.steps()).not.toContain('manifest');
    });

    it('manifest failure -> nonzero, but the message says the DATA file exists', async () => {
        const { code, out } = await run(happyHandlers({
            manifest: () => fail(1, 'bash: /home/owner/snapshots/x.meta.json: No space left on device'),
        }));
        expect(code).not.toBe(0);
        expect(out).toContain('data file DOES exist');
        expect(out).toContain('.tsv.gz');
    });
});

// ===========================================================================
// 3. --measure (read-only sizing; the embedding decision input)
// ===========================================================================

describe('--measure', () => {
    it('parses the four aggregates and exits 0 without touching any dump step', async () => {
        const t = new FakeTransport({
            measure: () => ok('1070000|9663676416|8589934592|5368709120\n'),
        });
        const logs: string[] = [];
        const code = await measure(cfg({ measure: true }), t, s => logs.push(s));
        expect(code).toBe(0);
        expect(t.steps()).toEqual(['measure']);
        expect(t.script('measure')).toContain('pg_total_relation_size');
        expect(t.script('measure')).toContain('pg_column_size(embedding)');
        const out = logs.join('\n');
        expect(out).toContain('1070000');
        expect(out).toContain('read-only');
    });

    it('transport failure -> nonzero', async () => {
        const t = new FakeTransport({ measure: () => fail(255, 'ssh: timeout') });
        const code = await measure(cfg({ measure: true }), t, () => undefined);
        expect(code).not.toBe(0);
    });

    it('garbage output -> nonzero, never a fabricated size report', async () => {
        const t = new FakeTransport({ measure: () => ok('psql: warning\n') });
        const code = await measure(cfg({ measure: true }), t, () => undefined);
        expect(code).not.toBe(0);
    });
});

// ===========================================================================
// 4. Pure helpers
// ===========================================================================

describe('parseCount is strict (absence is not zero)', () => {
    it.each([
        ['1000\n', 1000],
        ['0', 0],
        ['', null],
        ['  \n', null],
        ['12 34', null],
        ['1e5', null],
        ['-5', null],
        ['ERROR: boom', null],
    ])('%j -> %p', (input, expected) => {
        expect(parseCount(input as string)).toBe(expected);
    });
});

describe('shellQuote', () => {
    it('wraps plain strings', () => {
        expect(shellQuote('abc')).toBe(`'abc'`);
    });
    it('survives embedded single quotes', () => {
        expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`);
    });
    it('quotes the empty string', () => {
        expect(shellQuote('')).toBe(`''`);
    });
});

describe('isSafeColumnName', () => {
    it.each([
        ['barcode', true],
        ['nutrientsPer100g', true],
        ['_x', true],
        ['bad"col', false],
        ['drop table', false],
        ['1starts', false],
        ['', false],
    ])('%j -> %p', (name, expected) => {
        expect(isSafeColumnName(name as string)).toBe(expected);
    });
});

describe('buildCopySql', () => {
    it('quotes every identifier and orders deterministically', () => {
        const sql = buildCopySql(['barcode', 'name']);
        expect(sql).toBe('COPY (SELECT "barcode","name" FROM "OffFood" ORDER BY "barcode") TO STDOUT');
    });
});

describe('parseLabeled', () => {
    const KEYS = ['LINES', 'COLS'];
    it('parses labeled lines and ignores noise', () => {
        expect(parseLabeled('noise\nLINES=5\nCOLS=3\n', KEYS)).toEqual({ LINES: '5', COLS: '3' });
    });
    it('a missing key is null', () => {
        expect(parseLabeled('LINES=5\n', KEYS)).toBeNull();
    });
    it('a duplicated key is null (ambiguity refuses)', () => {
        expect(parseLabeled('LINES=5\nLINES=6\nCOLS=3\n', KEYS)).toBeNull();
    });
});

describe('timestamps and paths', () => {
    it('timestampToken has no filename-hostile characters', () => {
        const tok = timestampToken(new Date('2026-07-27T04:31:09.123Z'));
        expect(tok).toBe('2026-07-27T04-31-09Z');
    });
    it('snapshotPaths: partial is dataFile + .partial; label and noembed land in the name', () => {
        const p = snapshotPaths(cfg({ label: 'preRepair', excludeEmbedding: true }));
        expect(p.dataFile).toBe('/home/owner/snapshots/OffFood-2026-07-27T12-00-00Z-preRepair-noembed.tsv.gz');
        expect(p.partialFile).toBe(p.dataFile + '.partial');
        expect(p.metaFile).toBe('/home/owner/snapshots/OffFood-2026-07-27T12-00-00Z-preRepair-noembed.meta.json');
    });
});

describe('restoreInstructions', () => {
    const c = cfg();
    const p = snapshotPaths(c);
    const lines = restoreInstructions(c, p, ['barcode', 'name', 'nutrientsPer100g'], 1234);
    const text = lines.join('\n');
    it('loads into a side table, never straight into OffFood', () => {
        expect(text).toContain('CREATE TABLE "OffFood_restore" (LIKE "OffFood")');
        expect(text).toContain('COPY "OffFood_restore"("barcode","name","nutrientsPer100g") FROM STDIN');
        expect(text).not.toContain('COPY "OffFood"(');
    });
    it('rolls back per-row via UPDATE ... FROM on barcode, and never SETs the key', () => {
        expect(text).toContain('UPDATE "OffFood" f SET "name"=s."name", "nutrientsPer100g"=s."nutrientsPer100g" FROM "OffFood_restore" s');
        expect(text).toContain('f."barcode"=s."barcode"');
        expect(text).not.toContain('SET "barcode"');
    });
    it('bakes the verified row count into the sanity step', () => {
        expect(text).toContain('MUST print 1234');
    });
});

describe('dbIdentityFromEnv never leaks and never guesses', () => {
    it('extracts user and db from a well-formed url', () => {
        const r = dbIdentityFromEnv({ DATABASE_URL: 'postgresql://appuser:dummy-not-real@10.0.0.1:5432/recipes?schema=public' } as NodeJS.ProcessEnv);
        expect(r).toEqual({ user: 'appuser', db: 'recipes' });
        expect(JSON.stringify(r)).not.toContain('dummy-not-real');
    });
    it('absent url -> nulls', () => {
        expect(dbIdentityFromEnv({} as NodeJS.ProcessEnv)).toEqual({ user: null, db: null });
    });
    it('malformed url -> nulls, no throw', () => {
        expect(dbIdentityFromEnv({ DATABASE_URL: 'not a url' } as NodeJS.ProcessEnv)).toEqual({ user: null, db: null });
    });
});

describe('parseCliArgs', () => {
    const env = {} as NodeJS.ProcessEnv;
    it('defaults match the documented topology', () => {
        const r = parseCliArgs([], env);
        if ('error' in r) throw new Error(r.error);
        expect(r.config.sshHost).toBe('owner@192.168.1.133');
        expect(r.config.container).toBe('mealspire-db');
        expect(r.config.outDir).toBe('/home/owner/snapshots');
        expect(r.config.excludeEmbedding).toBe(false);
        expect(r.config.measure).toBe(false);
    });
    it('flags override env, env overrides DATABASE_URL', () => {
        const e = {
            SNAPSHOT_SSH_HOST: 'x@y',
            SNAPSHOT_DB_USER: 'envuser',
            DATABASE_URL: 'postgresql://urluser:pw@h/urldb',
        } as NodeJS.ProcessEnv;
        const r = parseCliArgs(['--host', 'cli@host', '--db-name', 'clidb'], e);
        if ('error' in r) throw new Error(r.error);
        expect(r.config.sshHost).toBe('cli@host');
        expect(r.config.dbUser).toBe('envuser');
        expect(r.config.dbName).toBe('clidb');
    });
    it('DATABASE_URL identity is the fallback when no flag/env names it', () => {
        const r = parseCliArgs([], { DATABASE_URL: 'postgresql://urluser:pw@h/urldb' } as NodeJS.ProcessEnv);
        if ('error' in r) throw new Error(r.error);
        expect(r.config.dbUser).toBe('urluser');
        expect(r.config.dbName).toBe('urldb');
    });
    it('an unknown flag REFUSES instead of being silently ignored', () => {
        const r = parseCliArgs(['--exclude-embeding'], env); // deliberate typo
        expect('error' in r).toBe(true);
    });
    it('a value flag without a value refuses', () => {
        const r = parseCliArgs(['--label'], env);
        expect('error' in r).toBe(true);
    });
    it('a filename-hostile label refuses', () => {
        const r = parseCliArgs(['--label', '../../etc'], env);
        expect('error' in r).toBe(true);
    });
    it('booleans parse', () => {
        const r = parseCliArgs(['--exclude-embedding', '--measure'], env);
        if ('error' in r) throw new Error(r.error);
        expect(r.config.excludeEmbedding).toBe(true);
        expect(r.config.measure).toBe(true);
    });
});
