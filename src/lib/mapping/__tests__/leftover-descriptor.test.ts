import { stripLeftoverDescriptor } from '../leftover-descriptor';

const run = (s: string, brand: string | null = null) => stripLeftoverDescriptor(s, s, brand);

describe('stripLeftoverDescriptor', () => {
    const stripped: Array<[string, string]> = [
        ['leftover rice', 'rice'],
        ['a cup of leftover rice', 'a cup of rice'],
        ['left-over pizza', 'pizza'],
        ['Leftover Chinese Food', 'Chinese Food'],
        ['leftover lasagna noodles', 'lasagna noodles'],
        ["the kids' leftover chicken nuggets", "the kids' chicken nuggets"],
        ['chicken leftover since dinner', 'chicken since dinner'],
    ];
    it.each(stripped)('strips %s', (input, expected) => {
        expect(run(input)).toEqual({ baseName: expected, stripped: true });
    });

    const unchanged = [
        'leftovers',
        'leftover',
        'the leftover',
        'everything but the leftovers seasoning blend',
        'christmas leftovers curry kit',
        'rice left over from dinner',
        'left over pizza',
        "leftover's pizza",
        'leftover’s pizza',
        "tonight's leftovers: half a rotisserie chicken",
        'fried rice',
    ];
    it.each(unchanged)('leaves %s unchanged', (input) => {
        const r = run(input);
        expect(r.stripped).toBe(false);
        expect(r.baseName).toBe(input);
    });

    it('leaves a brand containing leftover alone', () => {
        const r = run('leftover co granola', 'Leftover Co');
        expect(r.stripped).toBe(false);
        expect(r.baseName).toBe('leftover co granola');
    });

    const twins: Array<[string, string]> = [
        ['leftover rice', 'rice'],
        ['leftover pizza', 'pizza'],
        ['leftover chinese food', 'chinese food'],
        ['leftover lasagna', 'lasagna'],
        ['one square leftover lasagna', 'one square lasagna'],
        ['leftover general tso chicken', 'general tso chicken'],
        ['the leftover tuna salad', 'the tuna salad'],
        ['some leftover casserole', 'some casserole'],
        ['a bit of leftover curry', 'a bit of curry'],
    ];
    it.each(twins)('seed %s equals twin %s', (seed, twin) => {
        expect(run(seed).baseName).toBe(run(twin).baseName);
    });
});
