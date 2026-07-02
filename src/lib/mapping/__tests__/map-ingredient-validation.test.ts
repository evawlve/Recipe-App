import { mapIngredientWithFatsecret } from '../map-ingredient';
import { FatSecretClient } from '../client';
import {
    getValidatedMappingByNormalizedName,
    saveValidatedMapping,
    trackValidationFailure,
} from '../validated-mapping-helpers';
import { rerankFatsecretCandidates } from '../ai-rerank';
import { refineSearchQuery } from '../ai-search-refine';
import { aiNormalizeIngredient } from '../ai-normalize';

// Mock dependencies
jest.mock('../client');
jest.mock('../validated-mapping-helpers');
jest.mock('../ai-validation', () => ({
    validateMappingWithAI: jest.fn().mockResolvedValue({
        approved: true,
        confidence: 0.9,
        reason: 'mocked',
        category: 'correct',
        detectedIssues: []
    })
}));
jest.mock('../ai-rerank');
jest.mock('../ai-search-refine');
jest.mock('../ai-normalize');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn().mockResolvedValue({ success: true }),
}));

describe('mapIngredientWithFatsecret Validation Flow', () => {
    const mockClient = new FatSecretClient() as jest.Mocked<FatSecretClient>;

    beforeEach(() => {
        jest.clearAllMocks();
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'not needed' });
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(null);
        (rerankFatsecretCandidates as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skipped' });
        (refineSearchQuery as jest.Mock).mockResolvedValue(null);

        // Default client mocks
        mockClient.autocompleteFoods.mockResolvedValue([]);
        mockClient.searchFoodsV4.mockResolvedValue([]);
        mockClient.getFoodDetails.mockImplementation(async (id) => ({
            id, name: id.includes('chicken') ? 'Chicken' : 'Mock Food', brandName: null, foodType: 'Generic', description: '',
            servings: [{
                id: 's1', measurementDescription: '1 serving', metricServingAmount: 100, metricServingUnit: 'g', servingWeightGrams: 100,
                calories: 100, protein: 10, carbohydrate: 10, fat: 10
            }]
        }));
    });

    it('should return cached mapping immediately if found', async () => {
        const cachedMapping = {
            foodId: 'cached-123',
            foodName: 'Cached Food',
            confidence: 0.95,
            source: 'cache',
        };
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(cachedMapping);

        const result = await mapIngredientWithFatsecret('test ingredient', { client: mockClient });

        expect(getValidatedMappingByNormalizedName).toHaveBeenCalledWith('test ingredient', 'fatsecret', 'test ingredient');
        expect(result).toEqual(cachedMapping);
        expect(mockClient.searchFoodsV4).not.toHaveBeenCalled();
    });

    it('should use AI rerank and save to cache on success', async () => {
        // Setup: search returns multiple candidates
        const candidate1 = { id: 'c1', name: 'Chicken A', brandName: null, foodType: 'Generic' };
        const candidate2 = { id: 'chicken', name: 'Chicken B', brandName: null, foodType: 'Generic' };
        mockClient.searchFoodsV4.mockResolvedValue([candidate1, candidate2]);

        // Setup: AI rerank picks candidate 2
        (rerankFatsecretCandidates as jest.Mock).mockResolvedValue({
            status: 'success',
            id: 'chicken',
            confidence: 0.9,
            rationale: 'Better match',
        });

        const result = await mapIngredientWithFatsecret('120g chicken', { client: mockClient });

        console.log('DEBUG TEST: result', JSON.stringify(result, null, 2));
        console.log('DEBUG TEST: rerank calls', (rerankFatsecretCandidates as jest.Mock).mock.calls.length);
        console.log('DEBUG TEST: save calls', (saveValidatedMapping as jest.Mock).mock.calls.length);

        expect(rerankFatsecretCandidates).toHaveBeenCalled();
        expect(result?.foodId).toBe('chicken');
        expect(saveValidatedMapping).toHaveBeenCalledWith(
            '120g chicken',
            expect.objectContaining({ foodId: 'chicken' }),
            expect.objectContaining({ approved: true, confidence: 0.9 }),
            expect.any(Object)
        );
    });

    it('should retry with refined query if initial search fails', async () => {
        // Setup: initial search returns nothing initially, but returns hit for refined query
        mockClient.searchFoodsV4.mockImplementation(async (query) => {
            if (query === 'refined chicken') {
                return [{ id: 'chicken', name: 'Bad Refined Chicken', brandName: null, foodType: 'Generic' }];
            }
            return [];
        });

        // Setup: refine query returns suggestion
        (refineSearchQuery as jest.Mock).mockResolvedValue({
            suggestedQuery: 'refined chicken',
            reason: 'typo fix',
        });

        const result = await mapIngredientWithFatsecret('120g bad chicken', { client: mockClient });

        expect(refineSearchQuery).toHaveBeenCalledWith('120g bad chicken', expect.any(Array));
        expect(mockClient.searchFoodsV4).toHaveBeenCalledWith('refined chicken', expect.any(Object));
        expect(result?.foodId).toBe('chicken');
    });

    it('should track failure if all attempts fail', async () => {
        // Setup: all searches fail
        mockClient.searchFoodsV4.mockResolvedValue([]);
        (refineSearchQuery as jest.Mock).mockResolvedValue(null);

        const result = await mapIngredientWithFatsecret('120g impossible query', { client: mockClient });

        expect(result).toBeNull();
        expect(trackValidationFailure).toHaveBeenCalledWith(
            '120g impossible query',
            expect.any(Object),
            expect.objectContaining({ approved: false, reason: 'no_candidates_found' })
        );
    });
});
