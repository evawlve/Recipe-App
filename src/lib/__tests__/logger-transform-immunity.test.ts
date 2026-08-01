/**
 * Guards the F6 root cause: production captured ZERO info-level logs.
 *
 * It was not a level threshold, not the transport, and not an env var. SWC's
 * `compiler.removeConsole` (next.config.ts) deleted every `console.info` /
 * `console.debug` CALL from the production bundle at build time, and the logger
 * routed through `console.info`. Measured on the box 2026-08-01: 0 lines carrying
 * `"level":"info"` in all 976,124 lines of ~/Recipe-App/logs/next-start.log,
 * against 9,128 warn and 67 error.
 *
 * These tests fail if anyone routes the logger back through `console`, ranks
 * `audit` where a threshold can reach it, or defaults the threshold below `warn`
 * in production.
 */

const LOGGER_PATH = '../logger';

type Spies = {
    stdout: jest.SpyInstance;
    stderr: jest.SpyInstance;
    consoleLog: jest.SpyInstance;
    consoleInfo: jest.SpyInstance;
    consoleDebug: jest.SpyInstance;
    consoleWarn: jest.SpyInstance;
    consoleError: jest.SpyInstance;
};

function installSpies(): Spies {
    return {
        stdout: jest.spyOn(process.stdout, 'write').mockImplementation(() => true),
        stderr: jest.spyOn(process.stderr, 'write').mockImplementation(() => true),
        consoleLog: jest.spyOn(console, 'log').mockImplementation(() => { }),
        consoleInfo: jest.spyOn(console, 'info').mockImplementation(() => { }),
        consoleDebug: jest.spyOn(console, 'debug').mockImplementation(() => { }),
        consoleWarn: jest.spyOn(console, 'warn').mockImplementation(() => { }),
        consoleError: jest.spyOn(console, 'error').mockImplementation(() => { }),
    };
}

/** Load a FRESH copy of the logger under the given env — the threshold is resolved at module load. */
function loadLogger(env: { LOG_LEVEL?: string; NODE_ENV?: string }) {
    let mod!: typeof import('../logger');
    jest.isolateModules(() => {
        const prevLevel = process.env.LOG_LEVEL;
        const prevNodeEnv = process.env.NODE_ENV;
        if (env.LOG_LEVEL === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = env.LOG_LEVEL;
        if (env.NODE_ENV === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
        else (process.env as Record<string, unknown>).NODE_ENV = env.NODE_ENV;

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        mod = require(LOGGER_PATH);

        if (prevLevel === undefined) delete process.env.LOG_LEVEL;
        else process.env.LOG_LEVEL = prevLevel;
        if (prevNodeEnv === undefined) delete (process.env as Record<string, unknown>).NODE_ENV;
        else (process.env as Record<string, unknown>).NODE_ENV = prevNodeEnv;
    });
    return mod.logger;
}

/** All lines written to either stream, as strings. */
function writtenLines(spies: Spies): string[] {
    return [...spies.stdout.mock.calls, ...spies.stderr.mock.calls].map(c => String(c[0]));
}

describe('logger is immune to console-stripping', () => {
    let spies: Spies;

    beforeEach(() => { spies = installSpies(); });
    afterEach(() => { jest.restoreAllMocks(); });

    it('routes every level through process.stdout/stderr and never through console.*', () => {
        // debug threshold so nothing is suppressed for the wrong reason.
        const logger = loadLogger({ LOG_LEVEL: 'debug' });

        logger.debug('t.debug');
        logger.info('t.info');
        logger.warn('t.warn');
        logger.error('t.error');
        logger.audit('t.audit');

        // THE guard: removeConsole only rewrites `console.<method>(...)` member
        // calls. If any of these fire, the production build can strip the logger
        // again exactly as it did before.
        expect(spies.consoleLog).not.toHaveBeenCalled();
        expect(spies.consoleInfo).not.toHaveBeenCalled();
        expect(spies.consoleDebug).not.toHaveBeenCalled();
        expect(spies.consoleWarn).not.toHaveBeenCalled();
        expect(spies.consoleError).not.toHaveBeenCalled();

        const lines = writtenLines(spies);
        expect(lines).toHaveLength(5);
        for (const msg of ['t.debug', 't.info', 't.warn', 't.error', 't.audit']) {
            const line = lines.find(l => l.includes(`"msg":"${msg}"`));
            expect(line).toBeDefined();
            // Real JSON, newline-terminated, so the file stays one-object-per-line.
            expect(line!.endsWith('\n')).toBe(true);
            expect(() => JSON.parse(line!)).not.toThrow();
        }
    });

    it('splits streams: debug/info to stdout, warn/error/audit to stderr', () => {
        const logger = loadLogger({ LOG_LEVEL: 'debug' });

        logger.info('s.info');
        logger.warn('s.warn');
        logger.audit('s.audit');

        const out = spies.stdout.mock.calls.map(c => String(c[0])).join('');
        const err = spies.stderr.mock.calls.map(c => String(c[0])).join('');
        expect(out).toContain('s.info');
        expect(err).toContain('s.warn');
        expect(err).toContain('s.audit');
        expect(out).not.toContain('s.audit');
    });
});

describe('audit is non-suppressible', () => {
    let spies: Spies;

    beforeEach(() => { spies = installSpies(); });
    afterEach(() => { jest.restoreAllMocks(); });

    // If `audit` is ever folded into the same numeric ordering the threshold
    // compares against, one of these cases starts failing.
    it.each(['debug', 'info', 'warn', 'error', 'silent'])(
        'emits an audit line at LOG_LEVEL=%s',
        (level) => {
            const logger = loadLogger({ LOG_LEVEL: level });
            // `level` in the context is deliberate: it must NOT shadow the real
            // level field, which is the thing operators grep on.
            logger.audit('a.always', { level, note: 'ctx must not shadow level' });

            const lines = writtenLines(spies);
            const auditLine = lines.find(l => l.includes('"msg":"a.always"'));
            expect(auditLine).toBeDefined();
            const parsed = JSON.parse(auditLine!);
            expect(parsed.level).toBe('audit');
            expect(parsed.note).toBe('ctx must not shadow level');
        },
    );

    it.each([
        ['debug', true],
        ['info', true],
        ['warn', false],
        ['error', false],
        ['silent', false],
    ])('at LOG_LEVEL=%s, info emitted === %s', (level, expected) => {
        const logger = loadLogger({ LOG_LEVEL: level as string });
        logger.info('a.info');
        const emitted = writtenLines(spies).some(l => l.includes('"msg":"a.info"'));
        expect(emitted).toBe(expected);
    });
});

describe('default threshold reproduces the measured production volume', () => {
    let spies: Spies;

    beforeEach(() => { spies = installSpies(); });
    afterEach(() => { jest.restoreAllMocks(); });

    it('LOG_LEVEL=warn suppresses info and debug but not warn or error', () => {
        const logger = loadLogger({ LOG_LEVEL: 'warn' });

        logger.debug('w.debug');
        logger.info('w.info');
        logger.warn('w.warn');
        logger.error('w.error');

        const lines = writtenLines(spies);
        expect(lines.some(l => l.includes('w.debug'))).toBe(false);
        expect(lines.some(l => l.includes('w.info'))).toBe(false);
        expect(lines.some(l => l.includes('w.warn'))).toBe(true);
        expect(lines.some(l => l.includes('w.error'))).toBe(true);
    });

    it('defaults to warn in production when LOG_LEVEL is unset — this change cannot flood the box', () => {
        const logger = loadLogger({ LOG_LEVEL: undefined, NODE_ENV: 'production' });

        logger.info('p.info');
        logger.warn('p.warn');

        const lines = writtenLines(spies);
        // 0 info lines is exactly what production emits today (measured 0 of 976,124).
        expect(lines.some(l => l.includes('p.info'))).toBe(false);
        expect(lines.some(l => l.includes('p.warn'))).toBe(true);
    });

    it('defaults to debug outside production so local development is unchanged', () => {
        const logger = loadLogger({ LOG_LEVEL: undefined, NODE_ENV: 'development' });

        logger.debug('d.debug');
        logger.info('d.info');

        const lines = writtenLines(spies);
        expect(lines.some(l => l.includes('d.debug'))).toBe(true);
        expect(lines.some(l => l.includes('d.info'))).toBe(true);
    });

    it('serialises Error context rather than dropping it', () => {
        const logger = loadLogger({ LOG_LEVEL: 'warn' });
        logger.warn('e.boom', { error: new Error('kaboom') });

        const line = writtenLines(spies).find(l => l.includes('e.boom'));
        expect(line).toBeDefined();
        const parsed = JSON.parse(line!);
        expect(parsed.error.message).toBe('kaboom');
        expect(parsed.error.name).toBe('Error');
    });
});
