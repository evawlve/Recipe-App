import { simpleRerank, toRerankCandidate } from '../simple-rerank';
import { candidateOwnsVolumeServing } from '../serving/hydration-lane';

// s458 TB: Tiebreaker 4 reads volumeServingMatch only inside an exact tie.
const base = (id: string, extra: Record<string, unknown> = {}) => toRerankCandidate({
    id, name: 'Creamer', brandName: null, score: 1, source: 'openfoodfacts',
    nutrition: { kcal: 180, protein: 0, carbs: 20, fat: 8, per100g: true }, ...extra,
});

describe('simpleRerank Tiebreaker 4 (volume serving, tie-only)', () => {
    it('an exact tie goes to the record that owns the volume serving, not the lower id', () => {
        const r = simpleRerank('creamer', [
            base('off_0093966008715', { volumeServingMatch: false }),
            base('off_0811620022385', { volumeServingMatch: true }),
        ], undefined, '1 tbsp creamer');
        expect(r.winner?.id).toBe('off_0811620022385');
    });
    it('without the flag (non-volume request) the id seat decides as before', () => {
        const r = simpleRerank('creamer', [
            base('off_0093966008715'), base('off_0811620022385'),
        ], undefined, '2 creamer');
        expect(r.winner?.id).toBe('off_0093966008715');
    });
    it('never beats a score difference', () => {
        const r = simpleRerank('creamer', [
            base('off_0093966008715', { volumeServingMatch: false }),
            toRerankCandidate({ id: 'off_0811620022385', name: 'Creamer Hazelnut Flavored', brandName: null, score: 1,
                source: 'openfoodfacts', nutrition: { kcal: 180, protein: 0, carbs: 20, fat: 8, per100g: true }, volumeServingMatch: true }),
        ], undefined, '1 tbsp creamer');
        expect(r.winner?.id).toBe('off_0093966008715');
    });
});

describe('candidateOwnsVolumeServing (tie-only predicate)', () => {
    const fs = (servings: Array<{ description: string; grams: number | null }>) =>
        ({ id: 'fs_1', source: 'fatsecret', name: 'Soy Sauce', score: 1, servings } as any);
    it('counts a FatSecret household serving in the unit (the 84-flip guard)', () => {
        expect(candidateOwnsVolumeServing(fs([{ description: '1 tbsp', grams: 16 }]), 'tbsp')).toBe(true);
        expect(candidateOwnsVolumeServing(fs([{ description: '100 g', grams: 100 }]), 'tbsp')).toBe(false);
        expect(candidateOwnsVolumeServing(fs([{ description: '1 tbsp', grams: null }]), 'tbsp')).toBe(false);
    });
    it('reads an OFF label serving from rawData', () => {
        const off = { id: 'off_1', source: 'openfoodfacts', name: 'Creamer', score: 1,
            rawData: { servingSize: '1 Tbsp (15 ml)', servingGrams: 15 } } as any;
        expect(candidateOwnsVolumeServing(off, 'tbsp')).toBe(true);
        expect(candidateOwnsVolumeServing(off, 'cup')).toBe(false);
    });
});
