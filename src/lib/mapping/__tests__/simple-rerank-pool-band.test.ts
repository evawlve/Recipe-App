/**
 * s453-PB: pool-consensus kcal band at the PICK (post-sort swap in simpleRerank()).
 * Fixtures were MEASURED on shipped code: with RANK_POOL_BAND='0' the winner is the
 * outlier OFF record named below (the id-seat tie decides it).
 */
import { simpleRerank, type RerankCandidate } from '../simple-rerank';
import corruptOffDenylist from '../data/corrupt-off-denylist.json';

type Src = RerankCandidate['source'];
const mk = (id: string, name: string, score: number, kcal: number | null, source: Src): RerankCandidate => ({
    id,
    name,
    score,
    source,
    ...(kcal === null ? {} : { nutrition: { kcal, protein: 5, carbs: 5, fat: 5, per100g: true } }),
});

const tofuPool = (): RerankCandidate[] => [
    mk('off_3070451041461', 'Tofu', 5.9, 13, 'openfoodfacts'),
    mk('off_5034467000056', 'Tofu', 5.8, 141, 'openfoodfacts'),
    mk('fs_1', 'Firm Tofu', 1.4, 82, 'fatsecret'),
    mk('fs_2', 'Silken Tofu', 1.3, 83, 'fatsecret'),
    mk('fdc_1', 'Tofu, raw, firm', 0.9, 106, 'fdc'),
    mk('fdc_2', 'Tofu, raw, regular', 0.85, 94, 'fdc'),
];
const jalPool = (): RerankCandidate[] => [
    mk('off_0757528008888', 'Jalapeno', 5.9, 481, 'openfoodfacts'),
    mk('off_74815241', 'Jalapeno', 5.5, 18, 'openfoodfacts'),
    mk('fs_a', 'Jalapeno Peppers', 1.4, 30, 'fatsecret'),
    mk('fs_b', 'Pickled Jalapeno', 1.3, 18, 'fatsecret'),
    mk('fdc_a', 'Peppers, jalapeno, raw', 0.9, 29, 'fdc'),
    mk('fdc_b', 'Peppers, jalapeno, canned', 0.8, 27, 'fdc'),
    mk('fs_c', 'Sliced Jalapeno', 1.2, 32, 'fatsecret'),
];
const shakePool = (): RerankCandidate[] => [
    mk('off_0000000000001', 'Protein Shake', 5.9, 52, 'openfoodfacts'),
    mk('off_0000000000002', 'Protein Shake', 5.8, 375, 'openfoodfacts'),
    mk('fs_s1', 'Protein Shake Powder', 1.4, 380, 'fatsecret'),
    mk('fs_s2', 'Whey Protein Shake', 1.3, 390, 'fatsecret'),
];

const run = (q: string, raw: string, pool: RerankCandidate[], isBranded = false, brand?: string) =>
    simpleRerank(q, pool, undefined, raw, isBranded, brand, false);

const withSwitch = <T>(v: string | undefined, fn: () => T): T => {
    const prev = process.env.RANK_POOL_BAND;
    if (v === undefined) delete process.env.RANK_POOL_BAND; else process.env.RANK_POOL_BAND = v;
    try { return fn(); } finally {
        if (prev === undefined) delete process.env.RANK_POOL_BAND; else process.env.RANK_POOL_BAND = prev;
    }
};

const scores = (r: ReturnType<typeof simpleRerank>) => r.rerankPool.map(p => [p.foodId, p.score]);

describe('pool band: fires', () => {
    it.each([
        ['tofu', 'a half block of tofu', tofuPool, 'off_3070451041461', 'off_5034467000056', 'tofu'],
        ['jalapeno', 'jalapeno', jalPool, 'off_0757528008888', 'off_74815241', 'jalapeno'],
    ])('%s: outlier OFF top is swapped for the in-band OFF record', (q, raw, pool, oldId, newId, headTok) => {
        const off = withSwitch('0', () => run(q, raw, pool()));
        expect(off.winner?.id).toBe(oldId);
        const on = withSwitch(undefined, () => run(q, raw, pool()));
        expect(on.winner?.id).toBe(newId);
        expect(on.winner!.name.toLowerCase()).toContain(headTok);
        expect(on.confidence).toBeGreaterThanOrEqual(0.70);
        expect(scores(on).sort()).toEqual(scores(off).sort());
        expect(on.rerankPool.find(p => p.foodId === oldId)?.poolBandDemoted).toBe(true);
        expect(on.rerankPool.filter(p => p.poolBandDemoted).length).toBe(1);
        expect(off.rerankPool.some(p => p.poolBandDemoted)).toBe(false);
        // every other entry keeps its order
        const offOrder = off.rerankPool.map(p => p.foodId).filter(i => i !== newId);
        const onOrder = on.rerankPool.map(p => p.foodId).filter(i => i !== newId);
        expect(onOrder).toEqual(offOrder);
    });
});

describe('pool band: unchanged', () => {
    const same = (pool: () => RerankCandidate[], q: string, raw: string, isBranded = false, brand?: string) => {
        const off = withSwitch('0', () => run(q, raw, pool(), isBranded, brand));
        const on = withSwitch(undefined, () => run(q, raw, pool(), isBranded, brand));
        expect(on.winner?.id).toBe(off.winner?.id);
        expect(on.rerankPool.some(p => p.poolBandDemoted)).toBe(false);
    };

    it('GUARD D: dry-grain panel is not promoted over a sub-280 kcal top', () => {
        const on = withSwitch(undefined, () => run('protein shake', 'a protein shake', shakePool()));
        expect(on.winner?.id).toBe('off_0000000000001');
        same(shakePool, 'protein shake', 'a protein shake');
    });

    it('GUARD G: promoted record below MIN_RERANK_CONFIDENCE is skipped', () => {
        const pool = () => tofuPool().filter(c => !['off_5034467000056', 'fs_1', 'fs_2'].includes(c.id));
        same(pool, 'tofu', 'a half block of tofu');
    });

    it('isBranded true', () => same(tofuPool, 'tofu', 'a half block of tofu', true));
    it('targetBrand set', () => same(tofuPool, 'tofu', 'a half block of tofu', false, 'nasoya'));

    it("RANK_POOL_BAND='0' keeps the outlier", () => {
        const off = withSwitch('0', () => run('tofu', 'a half block of tofu', tofuPool()));
        expect(off.winner?.id).toBe('off_3070451041461');
    });

    it('one ref only is not a consensus', () => {
        const pool = () => tofuPool().filter(c => !['fs_2', 'fdc_1', 'fdc_2'].includes(c.id));
        same(pool, 'tofu', 'a half block of tofu');
    });

    it('P floor-mismatched (denylisted OFF barcode) is not promoted', () => {
        const pool = () => [
            mk('off_3070451041461', 'Tofu', 5.9, 13, 'openfoodfacts'),
            mk(`off_${corruptOffDenylist[0].barcode}`, 'Tofu', 5.8, 141, 'openfoodfacts'),
            // zero-macro panels are floor-hit too, so every record behind the top sits on the
            // other side of the plausibility partition (measured: all three floor=true)
            { ...mk('fs_1', 'Firm Tofu', 1.4, 82, 'fatsecret'), nutrition: { kcal: 82, protein: 0, carbs: 0, fat: 0, per100g: true } },
            { ...mk('fs_2', 'Silken Tofu', 1.3, 83, 'fatsecret'), nutrition: { kcal: 83, protein: 0, carbs: 0, fat: 0, per100g: true } },
        ];
        const off = withSwitch('0', () => run('tofu', 'tofu', pool()));
        expect(off.rerankPool.slice(1).every(p => p.plausibilityFloorHit)).toBe(true);
        const on = withSwitch(undefined, () => run('tofu', 'tofu', pool()));
        expect(on.winner?.id).toBe(off.winner?.id);
        expect(on.rerankPool.some(p => p.poolBandDemoted)).toBe(false);
    });

    it('an FS record at 3x ref ahead of P is not promoted', () => {
        const pool = () => [
            mk('off_3070451041461', 'Tofu', 5.9, 13, 'openfoodfacts'),
            mk('fs_hi', 'Fried Tofu', 3.0, 250, 'fatsecret'),
            mk('off_5034467000056', 'Tofu', 2.0, 141, 'openfoodfacts'),
            mk('fs_1', 'Firm Tofu', 1.4, 82, 'fatsecret'),
            mk('fs_2', 'Silken Tofu', 1.3, 83, 'fatsecret'),
        ];
        const on = withSwitch(undefined, () => run('tofu', 'tofu', pool()));
        expect(on.winner?.id).not.toBe('fs_hi');
        expect(on.rerankPool.map(p => p.foodId).indexOf('fs_hi')).toBeGreaterThanOrEqual(0);
    });

    it('a kcal-less record ahead of P is not promoted', () => {
        const pool = () => [
            mk('off_3070451041461', 'Tofu', 5.9, 13, 'openfoodfacts'),
            mk('off_nokcal', 'Tofu', 5.85, null, 'openfoodfacts'),
            mk('off_5034467000056', 'Tofu', 5.8, 141, 'openfoodfacts'),
            mk('fs_1', 'Firm Tofu', 1.4, 82, 'fatsecret'),
            mk('fs_2', 'Silken Tofu', 1.3, 83, 'fatsecret'),
        ];
        const on = withSwitch(undefined, () => run('tofu', 'tofu', pool()));
        expect(on.winner?.id).not.toBe('off_nokcal');
    });
});
