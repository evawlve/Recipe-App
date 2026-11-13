import * as fs from 'fs';
import * as path from 'path';
import { normalizeIngredientName, clearRulesCache } from '../normalization-rules';

/**
 * S202: a food-log `lasagna` is the dish, not dry lasagna noodles. The bare
 * `lasagna -> lasagna noodles` synonym rewrite (a recipe-era guard) was removed
 * from BOTH DEFAULT_RULES and data/fatsecret/normalization-rules.json
 * (readRulesFile() prefers the JSON).
 */
const clean = (x: string) => normalizeIngredientName(x).cleaned;

beforeEach(() => {
    clearRulesCache();
});

describe('lasagna is the dish', () => {
    it('bare lasagna stays lasagna', () => {
        expect(clean('lasagna')).toBe('lasagna');
    });
    it('homemade lasagna keeps lasagna and gains no noodles', () => {
        const c = clean('homemade lasagna');
        expect(c).toContain('lasagna');
        expect(c).not.toContain('noodles');
    });
    it('cheese lasagna gains no noodles', () => {
        expect(clean('cheese lasagna')).not.toContain('noodles');
    });
    it('zucchini lasagna gains no noodles', () => {
        expect(clean('zucchini lasagna')).not.toContain('noodles');
    });
    it('lasagna noodles is unchanged', () => {
        expect(clean('lasagna noodles')).toBe('lasagna noodles');
    });
    it('lasagna soup gains no noodles', () => {
        expect(clean('lasagna soup')).not.toContain('noodles');
    });
});

describe('both rule sources agree', () => {
    it('the JSON rules file has no bare lasagna rewrite', () => {
        const file = path.join(process.cwd(), 'data/fatsecret/normalization-rules.json');
        const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
        const hit = (rules.synonym_rewrites as Array<{ from: string }>).filter(r => r.from === 'lasagna');
        expect(hit).toEqual([]);
    });
    it('DEFAULT_RULES source text has no bare lasagna rewrite', () => {
        const file = path.join(process.cwd(), 'src/lib/mapping/normalization-rules.ts');
        const src = fs.readFileSync(file, 'utf8');
        expect(src).not.toContain("from: 'lasagna',");
    });
});
