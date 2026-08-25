/**
 * Ground-meat identity (2026-08-24, Lane A ride-along off the D-A9 gate).
 *
 * Two defects, one mechanism: `ground` was a prep phrase everywhere, and the
 * leanness default (`ground X` -> `85% lean 15% fat X`) fired on meats whose
 * corpora never carry that phrasing.
 *   - `ground chicken` was searched as `85% lean 15% fat chicken`: 0 chicken
 *     records in OffFood / FatSecretFood / FdcFood are labelled that way (census
 *     2026-08-24), so the line gathered beef/turkey rows, admitted none and fell
 *     to the AI-stub lane (100 g / 165 kcal, `ai_estimated`, live on
 *     qwm6HGP465bEqu0Upz5_l) while "Ground Chicken" fs_1737 and FDC 171116 sat
 *     unreached.
 *   - `ground lamb` (not in the default's list) was prep-stripped to `lamb` and
 *     shared that cache key with bare `lamb`, whose FoodMapping row is a
 *     human-triage NZ SHOULDER cut (usedCount 96): a warm `ground lamb` billed a
 *     shoulder.
 *
 * Fix: the default keeps `beef|turkey` (OFF 230 / 11 rows at "85% lean"), and
 * `ground <chicken|pork|lamb|bison|veal|venison|meat>` joins
 * PROTECTED_PRODUCT_PHRASES so `ground` survives into the retrieval text AND the
 * cache key. Every "master:" comment below is master's own output, measured with
 * tsx against 81cf589 on 2026-08-24, so the change is proven inert outside its
 * scope (beef, turkey, hamburger, and `ground` as prep on non-meats).
 */
import { normalizeIngredientName } from '../normalization-rules';
import { deriveStaticCoverageKey } from '../../ops/cache-coverage';

// [line, cleaned, mapper key]
const changed: Array<[string, string, string]> = [
    ['ground chicken', 'ground chicken', 'chicken ground'], // master: 85% lean 15% fat chicken / 15% 85% chicken fat lean
    ['ground pork', 'ground pork', 'ground pork'], // master: 85% lean 15% fat pork
    ['ground lamb', 'ground lamb', 'ground lamb'], // master: lamb / lamb  (the collision)
    ['ground bison', 'ground bison', 'bison ground'], // master: bison / bison
    ['ground veal', 'ground veal', 'ground veal'], // master: veal / veal
    ['ground venison', 'ground venison', 'ground venison'], // master: venison / venison
    ['ground meat', 'ground meat', 'ground meat'], // master: 85% lean 15% fat meat (a meatloaf record, live)
    ['lean ground chicken', 'lean ground chicken', 'chicken ground lean'], // master: 90% lean 10% fat chicken
    ['lean ground pork', 'lean ground pork', 'ground lean pork'], // master: 90% lean 10% fat pork
    ['extra lean ground chicken', 'lean ground chicken', 'chicken ground lean'], // master: 90% lean 10% fat chicken ('extra' is prep)
    ['ground chicken breast', 'ground chicken breast', 'breast chicken ground'], // master: skinless chicken breast (a BREAST)
    ['ground chicken thigh', 'ground chicken thigh', 'chicken ground thigh'], // master: 85% lean 15% fat chicken thigh
    ['ground chicken 93% lean', 'ground chicken 93% lean', '93% chicken ground lean'], // master: chicken 93% lean
    ['organic ground chicken', 'organic ground chicken', 'chicken ground organic'], // master: organic 85% lean 15% fat chicken
];

const unchanged: Array<[string, string, string]> = [
    ['ground beef', '85% lean 15% fat beef', '15% 85% beef fat lean'],
    ['ground turkey', '85% lean 15% fat turkey', '15% 85% fat lean turkey'],
    ['lean ground beef', '90% lean 10% fat beef', '10% 90% beef fat lean'],
    ['lean ground turkey', '90% lean 10% fat turkey', '10% 90% fat lean turkey'],
    ['93% lean ground turkey', '93% lean turkey', '93% lean turkey'],
    ['hamburger', '85% lean 15% fat beef', '15% 85% beef fat lean'],
    ['hamburger meat', '85% lean 15% fat beef meat', '15% 85% beef fat lean meat'],
    ['lean hamburger', '90% lean 10% fat beef', '10% 90% beef fat lean'],
    ['turkey burger', 'turkey burger', 'burger turkey'],
    ['chicken', 'chicken', 'chicken'],
    ['lamb', 'lamb', 'lamb'],
    ['pork', 'pork', 'pork'],
    ['chicken breast', 'skinless chicken breast', 'breast chicken skinless'],
    ['ground flaxseed', 'flaxseed', 'flaxseed'],
    ['ground cinnamon', 'cinnamon', 'cinnamon'],
    ['ground coffee', 'coffee', 'coffee'],
    ['ground almonds', 'almonds', 'almond'],
    ['ground cumin', 'cumin', 'cumin'],
    ['ground sausage', 'sausage', 'sausage'],
    ['chicken sausage', 'chicken sausage', 'chicken sausage'],
];

describe('ground-meat identity: the leanness default is beef|turkey only', () => {
    it.each(changed)('%s -> %s (key %s)', (line, cleaned, key) => {
        expect(normalizeIngredientName(line).cleaned).toBe(cleaned);
        expect(deriveStaticCoverageKey(line)).toBe(key);
    });

    it('never injects a leanness phrasing for chicken, pork or meat', () => {
        for (const line of ['ground chicken', 'ground pork', 'ground meat', 'lean ground chicken', 'lean ground pork']) {
            expect(normalizeIngredientName(line).cleaned).not.toMatch(/\d{2}% (lean|fat)/);
        }
    });

    it('keeps `ground` out of the stripped list for a protected meat, and in it for a non-meat', () => {
        expect(normalizeIngredientName('ground chicken').stripped).not.toContain('ground');
        expect(normalizeIngredientName('ground cinnamon').stripped).toContain('ground');
    });
});

describe('ground-meat identity: the cache key no longer collides with the bare noun', () => {
    it.each([
        ['ground chicken', 'chicken'],
        ['ground pork', 'pork'],
        ['ground lamb', 'lamb'],
        ['ground bison', 'bison'],
        ['ground veal', 'veal'],
        ['ground chicken breast', 'chicken breast'],
    ])('%s and %s derive different keys', (ground, bare) => {
        expect(deriveStaticCoverageKey(ground)).not.toBe(deriveStaticCoverageKey(bare));
    });
});

describe('ground-meat identity: everything outside the scope is master-identical', () => {
    it.each(unchanged)('%s -> %s (key %s)', (line, cleaned, key) => {
        expect(normalizeIngredientName(line).cleaned).toBe(cleaned);
        expect(deriveStaticCoverageKey(line)).toBe(key);
    });
});
