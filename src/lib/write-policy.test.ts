/**
 * write-policy.ts — the propagation contract, pinned.
 *
 * These are not "does a Set contain a string" tests. Each one pins a property the
 * suppression depends on and that a plausible refactor would silently break:
 *
 *   1. THE INSTANCE IS SHARED ACROSS MODULE INSTANCES. `jest.resetModules()` gives two
 *      distinct copies of the module — the closest thing jest has to Next emitting
 *      `src/lib/**` into two server chunks. Mutating through one copy inside a `run()` and
 *      reading through the other proves the `AsyncLocalStorage` lives on `globalThis`. A
 *      module-local instance passes every other test in this file and fails only this one,
 *      in production, invisibly, by WRITING.
 *   2. NO STORE MEANS NO POLICY. Scripts, other routes and warm-cache jobs never call
 *      `runWithWritePolicy()`, so the un-scoped behaviour is their contract.
 *   3. THE STORE SURVIVES EVERY CONTINUATION THE MAPPER USES — `await`, `Promise.all`,
 *      timers, dynamic `import()`. The mapper is all four.
 *   4. A WAITER KEEPS ITS OWN POLICY. `mapIngredientWithFallback()`'s in-flight lock lets a
 *      real request `await` a `nosave` request's promise; if the store followed the promise
 *      instead of the awaiting frame, a real user's writes would vanish because a measurement
 *      run happened to be mapping the same line.
 *   5. NESTING SHARES THE RECEIPT. The route nests a per-item scope inside the request scope,
 *      so one read after `Promise.all` has to see what every item did.
 *   6. `consulted` COUNTS EVEN WHEN THE ANSWER IS `false` — the fail-open detector. See
 *      constraint 3 in the module header.
 */

import type * as WritePolicyModule from './write-policy';

type WritePolicy = typeof WritePolicyModule;

/** A fresh module instance. Two of these share one ALS only if it is on `globalThis`. */
function freshModuleInstance(): WritePolicy {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./write-policy') as WritePolicy;
}

const wp = (): WritePolicy => freshModuleInstance();

// ---------------------------------------------------------------------------
// 1. globalThis identity
// ---------------------------------------------------------------------------

describe('the AsyncLocalStorage instance lives on globalThis', () => {
    it('two module instances across jest.resetModules() share ONE store', () => {
        const first = freshModuleInstance();
        const second = freshModuleInstance();

        // Genuinely two module objects — otherwise this test proves nothing.
        expect(second).not.toBe(first);

        const out = first.runWithWritePolicy({ suppress: ['aiServing'] }, () => {
            // Written and read through the OTHER copy of the module.
            const suppressed = second.isWriteSuppressed('aiServing');
            second.noteRefusedWrite('aiServing', 'FdcServing', 'fdc_747997:1 cup');
            return { suppressed, receipt: first.currentWriteReceipt() };
        });

        expect(out.suppressed).toBe(true);
        expect(out.receipt).not.toBeNull();
        expect(out.receipt!.refusedTotal).toBe(1);
        expect(out.receipt!.refused).toEqual([
            { kind: 'aiServing', table: 'FdcServing', key: 'fdc_747997:1 cup' },
        ]);
        expect(out.receipt!.consulted).toBe(1);
    });

    it('a scope opened through one instance is visible to the other, and closes for both', () => {
        const first = freshModuleInstance();
        const second = freshModuleInstance();

        first.runWithWritePolicy({ suppress: ['segmentationCache'] }, () => {
            expect(second.currentWriteReceipt()).not.toBeNull();
        });

        expect(second.currentWriteReceipt()).toBeNull();
        expect(first.currentWriteReceipt()).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// 2. no store = no policy
// ---------------------------------------------------------------------------

describe('outside any runWithWritePolicy()', () => {
    it('isWriteSuppressed() is false for every kind', () => {
        const p = wp();
        expect(p.isWriteSuppressed('aiServing')).toBe(false);
        expect(p.isWriteSuppressed('segmentationCache')).toBe(false);
    });

    it('noteRefusedWrite() is a no-op and cannot throw', () => {
        const p = wp();
        expect(() => p.noteRefusedWrite('aiServing', 'FdcServing', 'fdc_1:cup')).not.toThrow();
        expect(p.currentWriteReceipt()).toBeNull();
    });

    it('a refusal recorded outside a scope does not leak into the next scope', () => {
        const p = wp();
        p.noteRefusedWrite('aiServing', 'FdcServing', 'orphan');
        const receipt = p.runWithWritePolicy({ suppress: [] }, () => p.currentWriteReceipt());
        expect(receipt!.refusedTotal).toBe(0);
        expect(receipt!.refused).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// 3. propagation through every continuation the mapper uses
// ---------------------------------------------------------------------------

describe('the store survives the continuations the mapper actually makes', () => {
    it('survives await, Promise.all, setTimeout(0) and dynamic import()', async () => {
        const p = wp();

        const seen = await p.runWithWritePolicy({ suppress: ['aiServing'] }, async () => {
            const afterAwait = await Promise.resolve(p.isWriteSuppressed('aiServing'));

            const [a, b] = await Promise.all([
                (async () => p.isWriteSuppressed('aiServing'))(),
                (async () => {
                    await new Promise((r) => setTimeout(r, 0));
                    return p.isWriteSuppressed('aiServing');
                })(),
            ]);

            const dynamic = await import('./write-policy');
            const afterImport = dynamic.isWriteSuppressed('aiServing');

            return { afterAwait, a, b, afterImport };
        });

        expect(seen).toEqual({ afterAwait: true, a: true, b: true, afterImport: true });
    });

    it('two concurrent scopes do not see each other', async () => {
        const p = wp();

        const [nosave, real] = await Promise.all([
            p.runWithWritePolicy({ suppress: ['aiServing'] }, async () => {
                await new Promise((r) => setTimeout(r, 0));
                return p.isWriteSuppressed('aiServing');
            }),
            p.runWithWritePolicy({ suppress: [] }, async () => {
                await new Promise((r) => setTimeout(r, 0));
                return p.isWriteSuppressed('aiServing');
            }),
        ]);

        expect(nosave).toBe(true);
        expect(real).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 4. the in-flight-lock case
// ---------------------------------------------------------------------------

describe('a scope awaiting another scope\'s promise reads ITS OWN policy', () => {
    it('a real request waiting on a nosave request\'s lock is not suppressed', async () => {
        const p = wp();

        // The nosave request holds the "lock": a promise the other request will await.
        let releaseLock: () => void = () => undefined;
        const lock = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });
        const nosaveRequest = p.runWithWritePolicy({ suppress: ['aiServing'] }, async () => {
            await lock;
            return p.isWriteSuppressed('aiServing');
        });

        // The real request awaits the nosave request's own promise, exactly as
        // mapIngredientWithFallback() does with inFlightLocks.
        const realRequest = p.runWithWritePolicy({ suppress: [] }, async () => {
            await nosaveRequest;
            return {
                suppressed: p.isWriteSuppressed('aiServing'),
                receipt: p.currentWriteReceipt(),
            };
        });

        releaseLock();

        expect(await nosaveRequest).toBe(true);
        const real = await realRequest;
        expect(real.suppressed).toBe(false);
        // …and it did not inherit the other request's receipt either.
        expect(real.receipt!.suppress).toEqual([]);
        expect(real.receipt!.refusedTotal).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 5. nesting
// ---------------------------------------------------------------------------

describe('nested scopes share the receipt and cannot un-suppress', () => {
    it('a child shares the parent\'s refused array and counters', () => {
        const p = wp();

        const receipt = p.runWithWritePolicy({ suppress: ['aiServing'] }, () => {
            p.runWithWritePolicy({ suppress: [], line: '1 cup egg whites' }, () => {
                expect(p.isWriteSuppressed('aiServing')).toBe(true);
                p.noteRefusedWrite('aiServing', 'FdcServing', 'fdc_747997:1 cup');
            });
            p.runWithWritePolicy({ suppress: [], line: '2 eggs' }, () => {
                expect(p.isWriteSuppressed('aiServing')).toBe(true);
                p.noteRefusedWrite('aiServing', 'AiGeneratedServing', 'ai_egg:1 large');
            });
            return p.currentWriteReceipt();
        });

        expect(receipt!.refusedTotal).toBe(2);
        expect(receipt!.consulted).toBe(2);
        expect(receipt!.refused.map((r) => r.line)).toEqual(['1 cup egg whites', '2 eggs']);
        expect(receipt!.refused.map((r) => r.table)).toEqual(['FdcServing', 'AiGeneratedServing']);
    });

    it('a nested suppress: [] does NOT un-suppress the parent (monotonic)', () => {
        const p = wp();

        const inner = p.runWithWritePolicy({ suppress: ['aiServing', 'segmentationCache'] }, () =>
            p.runWithWritePolicy({ suppress: [] }, () => ({
                ai: p.isWriteSuppressed('aiServing'),
                seg: p.isWriteSuppressed('segmentationCache'),
            })),
        );

        expect(inner).toEqual({ ai: true, seg: true });
    });

    it('a child may ADD a kind without the parent keeping it afterwards', () => {
        const p = wp();

        const out = p.runWithWritePolicy({ suppress: ['aiServing'] }, () => {
            const inChild = p.runWithWritePolicy({ suppress: ['segmentationCache'] }, () =>
                p.isWriteSuppressed('segmentationCache'),
            );
            return { inChild, afterChild: p.isWriteSuppressed('segmentationCache') };
        });

        expect(out).toEqual({ inChild: true, afterChild: false });
    });
});

// ---------------------------------------------------------------------------
// 6. consulted, and the exact/sample split
// ---------------------------------------------------------------------------

describe('the receipt distinguishes "refused nothing" from "nobody asked"', () => {
    it('consulted bumps even when the answer is false', () => {
        const p = wp();

        const receipt = p.runWithWritePolicy({ suppress: [] }, () => {
            expect(p.isWriteSuppressed('aiServing')).toBe(false);
            expect(p.isWriteSuppressed('segmentationCache')).toBe(false);
            return p.currentWriteReceipt();
        });

        // consulted > 0 with refusedTotal 0 is the honest "refused nothing".
        expect(receipt!.consulted).toBe(2);
        expect(receipt!.refusedTotal).toBe(0);
    });

    it('a scope where no writer ever asks reads consulted 0 — the structural RED', () => {
        const p = wp();
        const receipt = p.runWithWritePolicy({ suppress: ['aiServing'] }, () => p.currentWriteReceipt());
        expect(receipt!.consulted).toBe(0);
        expect(receipt!.refusedTotal).toBe(0);
    });

    it('refusedTotal stays EXACT past the sample cap', () => {
        const p = wp();

        const receipt = p.runWithWritePolicy({ suppress: ['aiServing'] }, () => {
            for (let i = 0; i < p.REFUSAL_SAMPLE_CAP + 10; i++) {
                p.noteRefusedWrite('aiServing', 'FdcServing', `fdc_${i}:cup`);
            }
            return p.currentWriteReceipt();
        });

        expect(receipt!.refusedTotal).toBe(p.REFUSAL_SAMPLE_CAP + 10);
        expect(receipt!.refused).toHaveLength(p.REFUSAL_SAMPLE_CAP);
        expect(receipt!.refusedCap).toBe(p.REFUSAL_SAMPLE_CAP);
    });

    it('the receipt is a copy — a reader cannot mutate the live store', () => {
        const p = wp();

        const out = p.runWithWritePolicy({ suppress: ['aiServing'] }, () => {
            p.noteRefusedWrite('aiServing', 'FdcServing', 'fdc_1:cup');
            const first = p.currentWriteReceipt()!;
            first.refused.push({ kind: 'aiServing', table: 'Forged', key: 'nope' });
            first.refused[0].table = 'AlsoForged';
            return { second: p.currentWriteReceipt()! };
        });

        expect(out.second.refused).toEqual([
            { kind: 'aiServing', table: 'FdcServing', key: 'fdc_1:cup' },
        ]);
    });
});
