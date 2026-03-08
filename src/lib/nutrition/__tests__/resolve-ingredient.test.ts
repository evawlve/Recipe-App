import { resolveIngredient, type ResolvedIngredient } from '../resolve-ingredient';
import type { FatsecretMappedIngredient } from '../../fatsecret/map-ingredient';

describe('resolveIngredient', () => {
  const localResult: ResolvedIngredient = {
    source: 'local',
    system: 'usda_v2',
    rawLine: 'fallback',
    grams: 100,
    kcal: 200,
    protein: 10,
    carbs: 20,
    fat: 5,
    confidence: 0.9,
    local: {
      foodId: 'local-food',
      foodName: 'Local Food',
      portionSource: 'test',
      portionConfidence: 0.9,
    },
  };

  it('uses FatSecret result when confidence is high', async () => {
    const fatsecret: FatsecretMappedIngredient = {
      source: 'fatsecret',
      foodId: 'fs-1',
      foodName: 'FatSecret Food',
      grams: 50,
      kcal: 123,
      protein: 11,
      carbs: 5,
      fat: 4,
      confidence: 0.9,
      rawLine: 'line',
    } as FatsecretMappedIngredient;

    const result = await resolveIngredient('test', {
      dependencies: {
        mapWithFatsecret: async () => fatsecret,
        resolveLocally: async () => localResult,
      },
    });

    expect(result.source).toBe('fatsecret');
    expect(result.grams).toBe(50);
  });

  it('falls back to local when FatSecret returns null', async () => {
    const mapWithFatsecret = jest.fn().mockResolvedValue(null);
    const resolveLocally = jest.fn().mockResolvedValue(localResult);

    const result = await resolveIngredient('test', {
      dependencies: { mapWithFatsecret, resolveLocally },
    });

    expect(mapWithFatsecret).toHaveBeenCalled();
    expect(resolveLocally).toHaveBeenCalled();
    expect(result.source).toBe('local');
  });

  it('falls back when FatSecret confidence is too low', async () => {
    const fatsecret: FatsecretMappedIngredient = {
      source: 'fatsecret',
      foodId: 'fs-2',
      foodName: 'Low Confidence',
      grams: 80,
      kcal: 100,
      protein: 5,
      carbs: 10,
      fat: 2,
      confidence: 0.2,
      rawLine: 'line',
    } as FatsecretMappedIngredient;

    const result = await resolveIngredient('test', {
      minFatsecretConfidence: 0.7,
      dependencies: {
        mapWithFatsecret: async () => fatsecret,
        resolveLocally: async () => localResult,
      },
    });

    expect(result.source).toBe('local');
  });

  it('skips FatSecret when preferFatsecret is false', async () => {
    const mapWithFatsecret = jest.fn();
    const resolveLocally = jest.fn().mockResolvedValue(localResult);

    const result = await resolveIngredient('test', {
      preferFatsecret: false,
      dependencies: { mapWithFatsecret, resolveLocally },
    });

    expect(mapWithFatsecret).not.toHaveBeenCalled();
    expect(result.source).toBe('local');
  });
});
