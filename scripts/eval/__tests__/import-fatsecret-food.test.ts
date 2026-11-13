/**
 * import-fatsecret-food.ts — the two pure parts: the fail-closed argument parse and the
 * exit code. The refetch itself is `ensureFatSecretParentPersisted()`, pinned in the lane's
 * own suite; this script only reads the row back and reports.
 */
import { parseImportArgs, exitCodeFor } from '../import-fatsecret-food';

describe('parseImportArgs — fail closed', () => {
    test('no ids refuses', () => {
        expect(() => parseImportArgs([])).toThrow(/usage/);
        expect(() => parseImportArgs(['--apply'])).toThrow(/usage/);
    });

    test('a prefixed or non-numeric id refuses the WHOLE run, naming it', () => {
        expect(() => parseImportArgs(['25890', 'fs_72690975'])).toThrow(/fs_72690975/);
        expect(() => parseImportArgs(['abc'])).toThrow(/abc/);
    });

    test('bare numeric ids parse, dedupe, and --apply is read anywhere', () => {
        expect(parseImportArgs(['72690975', '68994926', '72690975'])).toEqual({
            fsIds: ['72690975', '68994926'],
            apply: false,
        });
        expect(parseImportArgs(['--apply', '25890'])).toEqual({ fsIds: ['25890'], apply: true });
        expect(parseImportArgs(['25890', '--apply'])).toEqual({ fsIds: ['25890'], apply: true });
    });
});

describe('exitCodeFor', () => {
    test('1 iff any record stayed absent', () => {
        expect(exitCodeFor(['IMPORTED', 'ALREADY_MIRRORED'])).toBe(0);
        expect(exitCodeFor(['DRY_RUN'])).toBe(0);
        expect(exitCodeFor([])).toBe(0);
        expect(exitCodeFor(['IMPORTED', 'ABSENT'])).toBe(1);
    });
});
