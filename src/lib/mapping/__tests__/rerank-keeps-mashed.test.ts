import { simpleRerank, stripPrepModifiers, toRerankCandidate } from '../simple-rerank';

describe('rerank query keeps `mashed` (C70 S239, cloud-36 C8)', () => {
    it('keeps mashed dishes unchanged', () => {
        expect(stripPrepModifiers('mashed potatoes')).toBe('mashed potatoes');
        expect(stripPrepModifiers('mashed sweet potatoes')).toBe('mashed sweet potatoes');
        expect(stripPrepModifiers('mashed cauliflower')).toBe('mashed cauliflower');
    });

    it('still strips real prep words (controls)', () => {
        expect(stripPrepModifiers('diced onion')).toBe('onion');
        expect(stripPrepModifiers('green peppers cut in strips')).toBe('green peppers');
        expect(stripPrepModifiers('shredded cheese')).toBe('cheese');
    });

    test('G13 mashed: the rerank query keeps `mashed` when there is no AI canonicalBase', () => {
        const nut = (kcal: number, f: number) => ({ kcal, protein: 2, carbs: 17, fat: f, per100g: true });
        const cands = [
            toRerankCandidate({ id: 'fdc_raw', name: 'Potatoes, raw', source: 'fdc', score: 0.9, nutrition: nut(77, 0.1) }),
            toRerankCandidate({ id: 'fs_mash', name: 'Mashed Potatoes', source: 'fatsecret', score: 0.9, nutrition: nut(113, 4.2) }),
        ];
        expect(simpleRerank(stripPrepModifiers('mashed potatoes'), cands, undefined, 'mashed potatoes').winner?.id).toBe('fs_mash');
    });
});
