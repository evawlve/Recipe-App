/**
 * Asserts the invariants of jest.setup.no-analysis-writes.js — the gate that
 * stops jest suites writing real logs/mapping-analysis-* files on dev machines
 * whose .env sets ENABLE_MAPPING_ANALYSIS=true. See that file for the measured
 * leak (9 suites, 2026-08-07) and the mechanism.
 *
 * Mirrors src/lib/ai/__tests__/no-live-llm-egress.test.ts: it does not trust the
 * setup file to have run — it loads `dotenv/config` itself and requires the pin
 * to survive, and it pins the setup file into BOTH jest projects so a config
 * edit cannot silently drop one.
 */

import fs from 'fs';
import path from 'path';

describe('no mapping-analysis file writes from jest', () => {
    it('ENABLE_MAPPING_ANALYSIS is pinned to the string false before any module import', () => {
        // Assigned (not deleted) by jest.setup.no-analysis-writes.js in setupFiles,
        // i.e. before the module-scope const in map-ingredient-with-fallback.ts is
        // captured.
        expect(process.env.ENABLE_MAPPING_ANALYSIS).toBe('false');
    });

    it('ENABLE_AI_PARSE_LOG is pinned too — a separate const guards the ai-parse-events.jsonl append', () => {
        // The logs/ai-parse-events.jsonl appendFileSync in the same file is gated
        // by its own module-scope const (ENABLE_AI_PARSE_LOG), not by
        // ENABLE_MAPPING_ANALYSIS — pinning only the latter would still leak on a
        // machine opting into ENABLE_AI_PARSE_LOG=true.
        expect(process.env.ENABLE_AI_PARSE_LOG).toBe('false');
    });

    it('dotenv cannot restore the dev .env values over the pins', async () => {
        // dotenv only writes keys that are not already own-properties of
        // process.env, so the setup file's assignments must survive this import
        // even on a machine whose .env sets either flag to true.
        await import('dotenv/config');
        expect(process.env.ENABLE_MAPPING_ANALYSIS).toBe('false');
        expect(process.env.ENABLE_AI_PARSE_LOG).toBe('false');
    });

    it('both jest projects load the no-analysis-writes setup file', () => {
        const config = require('../../../../jest.config.js') as {
            projects: Array<{ displayName: string; setupFiles?: string[] }>;
        };
        expect(config.projects.length).toBeGreaterThanOrEqual(2);
        for (const project of config.projects) {
            expect(project.setupFiles ?? []).toContain(
                '<rootDir>/jest.setup.no-analysis-writes.js'
            );
        }
    });

    it('the setup file assigns the pin and never deletes the env var', () => {
        // A `delete` of either env key would hand dotenv permission to put the
        // dev machine's `true` straight back — same rule as jest.setup.no-llm.js.
        // (Worded without the literal delete-expression: CI's env-parity scan
        // greps `process.env.<NAME>` in src/** including comments.)
        const setupSource = fs.readFileSync(
            path.join(__dirname, '../../../../jest.setup.no-analysis-writes.js'),
            'utf-8'
        );
        // The header comment documents the delete-hands-dotenv-the-pen trap, so
        // strip comments and assert on the code alone.
        const codeOnly = setupSource
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(codeOnly).toContain("process.env.ENABLE_MAPPING_ANALYSIS = 'false'");
        expect(codeOnly).toContain("process.env.ENABLE_AI_PARSE_LOG = 'false'");
        expect(codeOnly).not.toMatch(/delete\s+process\.env/);
    });
});
