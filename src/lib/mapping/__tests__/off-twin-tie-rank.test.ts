/**
 * A7 / K4 (2026-08-24): inside simpleRerank()'s generic-preferred tie step (T2), a
 * brand-gapped OFF twin ranks behind the same-name, same-GS1-prefix row that carries
 * the brand — and nowhere else changes.
 *
 * Pins (a)–(h) of the build PR's gate plan, §4.4 of
 * sync-docs/reports/2026-08-24_a7-tie-arbitration-design.md (mobile repo). Pin (f) —
 * "falls through to ID tiebreaker when no AI estimate is provided" — already lives in
 * simple-rerank.test.ts and is left untouched.
 *
 * Every fixture is a SCORE TIE by construction, and the tie has the anatomy measured on
 * the real YES pools (cheez it: both rows total=1.114): the brandless row earns
 * NO_BRAND (+0.05) and the branded row earns SERVING_LABEL_BOOST (+0.05) for the label
 * serving the stub lacks — identical names, identical API score, no AI estimate, no
 * brand in the query — so the only thing that can order the rows is the tie chain
 * (phrase → brand rank → nutrition → id). A branded row WITHOUT the serving boost is
 * 0.05 behind and never reaches T2, which is the pre-existing behaviour and is not
 * what this change is about.
 */
import { simpleRerank, computeOffTwinRoles, brandTieRank, type RerankCandidate } from '../simple-rerank';

type Src = RerankCandidate['source'];

function row(
    id: string,
    name: string,
    source: Src,
    brandName: string | undefined,
    kcal: number,
): RerankCandidate {
    return {
        id,
        name,
        source,
        brandName,
        score: 1.0,
        nutrition: { kcal, protein: 0, carbs: 0, fat: 0, per100g: true },
        // Branded rows carry a label serving (the mapper precomputes this); the
        // brandless stub does not — that is exactly the gap this change is about.
        ...(brandName ? { servingLabelMatch: true } : {}),
    };
}

// The cheez-it shape from the design's YES set: same 7-digit prefix (0024100), same
// name, one brandless (the gap), one carrying the brand, kcal 6% apart.
const GAPPED = () => row('off_0024100118731', 'Cheez-It Original', 'openfoodfacts', undefined, 500);
const CARRIER = () => row('off_0024100226429', 'Cheez-It Original', 'openfoodfacts', 'Sunshine', 470);
const FS_BRANDED = () => row('fs_63588', 'Cheez-It Original', 'fatsecret', 'Kellogg', 480);
// A truly generic brandless row: different prefix, so it has no carrier twin.
const GENERIC = () => row('off_0099999118731', 'Cheez-It Original', 'openfoodfacts', undefined, 490);

function order(cands: RerankCandidate[]): string[] {
    const r = simpleRerank('cheez it original', cands, undefined);
    expect(r.winner).not.toBeNull();
    return r.sortedCandidates.map((c) => c.id);
}

describe('computeOffTwinRoles / brandTieRank', () => {
    it('assigns carrier/gapped to a same-prefix, same-name, kcal-agreeing OFF pair', () => {
        const roles = computeOffTwinRoles([GAPPED(), CARRIER(), FS_BRANDED(), GENERIC()]);
        expect(roles.get('off_0024100226429')).toBe('carrier');
        expect(roles.get('off_0024100118731')).toBe('gapped');
        expect(roles.has('fs_63588')).toBe(false);
        expect(roles.has('off_0099999118731')).toBe(false);
        expect(brandTieRank(CARRIER(), roles)).toBe(0);
        expect(brandTieRank(GAPPED(), roles)).toBe(1);
        expect(brandTieRank(FS_BRANDED(), roles)).toBe(2);
        expect(brandTieRank(GENERIC(), roles)).toBe(0);
    });

    it('reduces to the old brandName ? 1 : 0 order when no roles are assigned', () => {
        const roles = computeOffTwinRoles([]);
        expect(brandTieRank(GENERIC(), roles)).toBe(0);
        expect(brandTieRank(FS_BRANDED(), roles)).toBe(2);
        expect(brandTieRank(GAPPED(), roles)).toBe(0); // brandless, no carrier: the generic seat, as before
    });
});

describe('simpleRerank T2 — OFF twin pair', () => {
    it('(a) the carrier wins over its brand-gapped twin', () => {
        expect(order([GAPPED(), CARRIER()])[0]).toBe('off_0024100226429');
        expect(order([CARRIER(), GAPPED()])[0]).toBe('off_0024100226429');
    });

    it('(b) same name, different prefix: the brandless row still wins', () => {
        const otherPrefixCarrier = row('off_0099999226429', 'Cheez-It Original', 'openfoodfacts', 'Sunshine', 470);
        expect(order([GAPPED(), otherPrefixCarrier])[0]).toBe('off_0024100118731');
    });

    it('(c) the gapped OFF row still beats an FS branded same-name row (the K3 guard)', () => {
        const ids = order([FS_BRANDED(), GAPPED(), CARRIER()]);
        expect(ids).toEqual(['off_0024100226429', 'off_0024100118731', 'fs_63588']);
    });

    it('(d) a generic brandless row and a carrier are both rank 0: id order decides', () => {
        const ids = order([CARRIER(), GAPPED(), GENERIC()]);
        // 'off_0024100226429' < 'off_0099999118731' by localeCompare, both rank 0; gapped last of the OFF rows.
        expect(ids).toEqual(['off_0024100226429', 'off_0099999118731', 'off_0024100118731']);
    });

    it('(e) every permutation of {gapped, carrier, FS branded, generic} sorts to ONE order', () => {
        const base = [GAPPED(), CARRIER(), FS_BRANDED(), GENERIC()];
        const perms: RerankCandidate[][] = [];
        const permute = (arr: RerankCandidate[], k: number) => {
            if (k === arr.length) { perms.push(arr.slice()); return; }
            for (let i = k; i < arr.length; i++) {
                [arr[k], arr[i]] = [arr[i], arr[k]];
                permute(arr, k + 1);
                [arr[k], arr[i]] = [arr[i], arr[k]];
            }
        };
        permute(base, 0);
        expect(perms).toHaveLength(24);
        const orders = new Set(perms.map((p) => order(p.map((c) => ({ ...c }))).join('>')));
        expect(orders.size).toBe(1);
        expect([...orders][0]).toBe('off_0024100226429>off_0099999118731>off_0024100118731>fs_63588');
    });

    it('(g) twins 15% apart in kcal do NOT fire — the graft', () => {
        const farCarrier = row('off_0024100226429', 'Cheez-It Original', 'openfoodfacts', 'Sunshine', 425); // 500 vs 425 = 15%
        expect(computeOffTwinRoles([GAPPED(), farCarrier]).size).toBe(0);
        expect(order([GAPPED(), farCarrier])[0]).toBe('off_0024100118731');
    });

    it('(g′) a twin with no positive kcal does NOT fire', () => {
        const noKcal = { ...CARRIER(), nutrition: undefined };
        expect(computeOffTwinRoles([GAPPED(), noKcal]).size).toBe(0);
        expect(order([GAPPED(), noKcal])[0]).toBe('off_0024100118731');
    });

    it('(h) a stub whose sibling is also brandless does NOT fire', () => {
        const otherStub = row('off_0024100999999', 'Cheez-It Original', 'openfoodfacts', undefined, 500);
        expect(computeOffTwinRoles([GAPPED(), otherStub]).size).toBe(0);
        // id order between two rank-0 rows
        expect(order([otherStub, GAPPED()])).toEqual(['off_0024100118731', 'off_0024100999999']);
    });

    it('a junk brand string (unknown / n/a / none) is not a carrier', () => {
        for (const junk of ['unknown', 'n/a', 'none', 'x']) {
            const c = row('off_0024100226429', 'Cheez-It Original', 'openfoodfacts', junk, 470);
            expect(computeOffTwinRoles([GAPPED(), c]).size).toBe(0);
        }
    });

    it('does not fire when the query names a brand (T2 takes the brand-match branch instead)', () => {
        const r = simpleRerank('cheez it original', [GAPPED(), CARRIER()], undefined, undefined, true, 'sunshine');
        // brand-match branch: the row whose brand contains "sunshine" wins — same winner, different reason
        expect(r.winner!.id).toBe('off_0024100226429');
    });
});
