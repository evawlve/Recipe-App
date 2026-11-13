import * as fs from 'fs';
import * as path from 'path';
import { stripHomemadeDescriptor } from '../homemade-descriptor';
import { detectBrandInQuery } from '../brand-detector';

/**
 * S202 row 7(1a): `homemade` is a descriptor, not a brand or identity token —
 * unless a brand or a person owns the word.
 */

function run(line: string) {
    return stripHomemadeDescriptor(line, line, detectBrandInQuery(line).matchedBrand);
}

describe('stripHomemadeDescriptor — descriptor is stripped', () => {
    const cases: Array<[string, string]> = [
        ['homemade fried rice', 'fried rice'],
        ['a homemade burger', 'a burger'],
        ['homemade mac and cheese with velveeta', 'mac and cheese with velveeta'],
        ['homemade granola bar', 'granola bar'],
        ['1 cup homemade pasta', '1 cup pasta'],
        ['homemade-style chili', 'chili'],
        ['homemade style meatballs', 'meatballs'],
        ['kneaders homemade chicken noodle soup', 'kneaders chicken noodle soup'],
        ['home made pizza', 'pizza'],
        ['grandmas homemade zucchini fritters', 'grandmas zucchini fritters'],
        ['severino homemade pasta lasagna', 'severino pasta lasagna'],
        ['homemade lemonade', 'lemonade'],
        ['homemade jumbo shrimp', 'jumbo shrimp'],
    ];
    it.each(cases)('%s -> %s', (line, expected) => {
        const r = run(line);
        expect(r.baseName).toBe(expected);
        expect(r.stripped).toBe(true);
    });
});

describe('stripHomemadeDescriptor — unchanged', () => {
    const lines = [
        "mom's homemade mac and cheese",
        "marie callender's homemade chicken pot pie",
        "cheddar's homemade chicken pot pie",
        "rao's homemade marinara",
        'blue bell homemade vanilla',
        'a sandwich from home made with turkey',
        "grandma's homemade apple pie",
        'fried rice',
        'burger',
    ];
    it.each(lines)('%s', (line) => {
        const r = run(line);
        expect(r.baseName).toBe(line);
        expect(r.stripped).toBe(false);
    });
});

describe('brand lexicon no longer treats homemade as a brand', () => {
    it('detectBrandInQuery("homemade apple pie") has no matched brand', () => {
        expect(detectBrandInQuery('homemade apple pie').matchedBrand).toBeFalsy();
    });
    it("detectBrandInQuery(\"rao's homemade marinara\") keeps the brand-owned form", () => {
        expect(detectBrandInQuery("rao's homemade marinara").matchedBrand).toBe("rao's homemade");
    });
    it('the lexicon has 1863 entries and no homemade', () => {
        const lex = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', 'brand-lexicon.json'), 'utf8'),
        ) as string[];
        expect(lex).toHaveLength(1863);
        expect(lex).not.toContain('homemade');
    });
    it("build-brand-lexicon's STOPLIST contains 'homemade'", () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', '..', '..', '..', 'scripts', 'build-brand-lexicon.ts'),
            'utf8',
        );
        const start = src.indexOf('const STOPLIST = new Set<string>([');
        expect(start).toBeGreaterThan(-1);
        const end = src.indexOf(']);', start);
        expect(src.slice(start, end)).toContain("'homemade'");
    });
});
