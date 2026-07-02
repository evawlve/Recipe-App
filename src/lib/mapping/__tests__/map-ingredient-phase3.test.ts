import { mapIngredientWithFatsecret } from '../map-ingredient';
import { insertAiServing } from '../ai-backfill';
import { aiNormalizeIngredient } from '../ai-normalize';
import { FatSecretClient } from '../client';

// Mock dependencies
jest.mock('../ai-backfill');
jest.mock('../ai-normalize');
jest.mock('../client');

describe('mapIngredientWithFatsecret Phase 3', () => {
    const mockClient = new FatSecretClient() as jest.Mocked<FatSecretClient>;

    beforeEach(() => {
        jest.clearAllMocks();
        (insertAiServing as jest.Mock).mockResolvedValue({ success: true });
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'not needed' });
    });

    it('should retry with AI normalization if initial mapping fails', async () => {
        // Setup: search returns nothing for "weird name", hits for "better name"
        mockClient.autocompleteFoods.mockResolvedValue([]);
        mockClient.searchFoodsV4.mockImplementation(async (query) => {
            if (query.includes('better name')) {
                return [{ id: '123', name: 'better name', brandName: null, foodType: 'Generic', description: '' }];
            }
            return [];
        });

        // Setup: AI normalization returns a better name
        (aiNormalizeIngredient as jest.Mock).mockResolvedValueOnce({
            status: 'success',
            normalizedName: 'better name',
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
        });

        mockClient.getFoodDetails.mockResolvedValue({
            id: '123', name: 'better name', brandName: null, foodType: 'Generic', description: '',
            servings: [{
                id: 's1', measurementDescription: '1 serving', metricServingAmount: 100, metricServingUnit: 'g', servingWeightGrams: 100,
                calories: 100, protein: 10, carbohydrate: 10, fat: 10
            }]
        });

        const result = await mapIngredientWithFatsecret('weird name', { client: mockClient, minConfidence: 0.1 });

        expect(aiNormalizeIngredient).toHaveBeenCalledWith('weird name', expect.any(String));
        expect(result).not.toBeNull();
        expect(result?.foodName).toBe('better name');
    });

    it('should trigger inline AI backfill if servings are missing', async () => {
        // Setup: search returns a hit
        mockClient.searchFoodsV4.mockResolvedValue([
            { id: '456', name: 'food with no servings', brandName: null, foodType: 'Generic', description: '' }
        ]);

        // Setup: getFoodDetails returns no servings first, then servings after backfill
        let callCount = 0;
        mockClient.getFoodDetails.mockImplementation(async () => {
            callCount++;
            if (callCount === 1) {
                return {
                    id: '456', name: 'food with no servings', brandName: null, foodType: 'Generic', description: '',
                    servings: []
                };
            }
            return {
                id: '456', name: 'food with no servings', brandName: null, foodType: 'Generic', description: '',
                servings: [{
                    id: 's2', measurementDescription: '1 serving', metricServingAmount: 100, metricServingUnit: 'g', servingWeightGrams: 100,
                    calories: 100, protein: 10, carbohydrate: 10, fat: 10
                }]
            };
        });

        const result = await mapIngredientWithFatsecret('food with no servings', { client: mockClient, minConfidence: 0.1 });

        expect(insertAiServing).toHaveBeenCalledWith('456', 'weight');
        expect(mockClient.getFoodDetails).toHaveBeenCalled();
        expect(result).not.toBeNull();
        expect(result?.foodId).toBe('456');
    });
});
