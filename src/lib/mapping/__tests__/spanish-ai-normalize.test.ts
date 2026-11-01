/**
 * C6970 D30: aiNormalizeIngredient() with `{ spanish: true }`.
 * - The clause is sent ONLY on a Spanish call; an English request is byte-identical (systemPrompt === the base prompt).
 * - Spanish reads and saves go to the `ES:` namespace; English calls pass no namespace.
 * - A stubbed `huevos` -> `eggs` answer reaches the English `egg` FoodMapping key.
 * LLM mocked at the callStructuredLlm() chokepoint; cache helpers mocked (template: ai-normalize-deadline.test.ts).
 */
const mockCallStructuredLlm = jest.fn();
const mockGetCache = jest.fn();
const mockSaveCache = jest.fn();

jest.mock('../validated-mapping-helpers', () => ({
  getAiNormalizeCache: (...a: unknown[]) => mockGetCache(...a),
  saveAiNormalizeCache: (...a: unknown[]) => mockSaveCache(...a),
}));
jest.mock('../../ai/structured-client', () => ({
  callStructuredLlm: (...a: unknown[]) => mockCallStructuredLlm(...a),
}));

import { aiNormalizeIngredient, SYSTEM_PROMPT, SPANISH_CLAUSE, SPANISH_CACHE_NAMESPACE } from '../ai-normalize';
import { deriveMappingCacheKey } from '../cache-key';
import { PROMPT_EXAMPLE_IDENTITIES } from '../llm-output-guards';

function llmAnswer(name: string, base: string) {
  return {
    status: 'success', provider: 'openrouter', model: 'test-model',
    content: {
      normalized_name: name, canonical_base: base,
      prep_phrases: [], size_phrases: [], synonyms: [],
      cooking_modifier: null, nutrition_estimate: null,
      is_branded: false, is_multi_ingredient: false, split_ingredients: null, error: null,
    },
  };
}

beforeEach(() => {
  mockCallStructuredLlm.mockReset();
  mockGetCache.mockReset().mockResolvedValue(null);
  mockSaveCache.mockReset().mockResolvedValue(undefined);
});

describe('Spanish clause', () => {
  it('is present, translates, and keeps dish names and modifiers', () => {
    expect(SPANISH_CLAUSE).toContain('If the input food name is in Spanish, `normalized_name` and `canonical_base` MUST be the common English name of that food (huevos → eggs, leche → milk, arroz → rice, frijoles → beans, pollo → chicken).');
    expect(SPANISH_CLAUSE).toContain('Never translate a brand.');
    expect(SPANISH_CLAUSE).toContain('sin azúcar → sugar free');
    expect(SPANISH_CLAUSE).toContain('descremada → skim');
    expect(SPANISH_CLAUSE).toContain('medio/media means half');
    for (const k of ['bolillo', 'pozole', 'mole', 'concha', 'pan dulce', 'torta', 'nieve', 'tres leches']) expect(SPANISH_CLAUSE).toContain(k);
  });

  it('does not add its examples to PROMPT_EXAMPLE_IDENTITIES (the echo guard would refuse a real translation)', () => {
    const flat = JSON.stringify(PROMPT_EXAMPLE_IDENTITIES).toLowerCase();
    for (const w of ['eggs', 'milk', 'beans']) expect(flat).not.toContain(`"${w}"`);
  });
});

describe('aiNormalizeIngredient English vs Spanish', () => {
  it('English call: systemPrompt is exactly the base prompt, no namespace on read or save', async () => {
    mockCallStructuredLlm.mockResolvedValue(llmAnswer('plain bagel', 'plain bagel'));
    await aiNormalizeIngredient('plain bagel');
    const arg = mockCallStructuredLlm.mock.calls[0][0];
    expect(arg.systemPrompt).toBe(SYSTEM_PROMPT);
    expect(arg.systemPrompt).not.toContain('SPANISH INPUT');
    expect(mockGetCache).toHaveBeenCalledWith('plain bagel');
    expect(mockSaveCache.mock.calls[0]).toHaveLength(2);
    expect(mockSaveCache.mock.calls[0][0]).toBe('plain bagel');
  });

  it('English call with `{}` or `{spanish:false}` is also the base prompt', async () => {
    mockCallStructuredLlm.mockResolvedValue(llmAnswer('plain bagel', 'plain bagel'));
    await aiNormalizeIngredient('plain bagel', undefined, { spanish: false });
    expect(mockCallStructuredLlm.mock.calls[0][0].systemPrompt).toBe(SYSTEM_PROMPT);
    expect(mockGetCache).toHaveBeenCalledWith('plain bagel');
  });

  it('Spanish call: prompt = base + clause, reads and saves under ES:', async () => {
    mockCallStructuredLlm.mockResolvedValue(llmAnswer('eggs', 'egg'));
    const r = await aiNormalizeIngredient('huevos', 'huevos', { spanish: true });
    expect(r.status).toBe('success');
    if (r.status === 'success') {
      expect(r.normalizedName).toBe('eggs');
      expect(r.canonicalBase).toBe('egg');
    }
    expect(mockCallStructuredLlm.mock.calls[0][0].systemPrompt).toBe(`${SYSTEM_PROMPT}\n${SPANISH_CLAUSE}`);
    expect(SPANISH_CACHE_NAMESPACE).toBe('ES:');
    expect(mockGetCache).toHaveBeenCalledWith('huevos', { namespace: 'ES:' });
    expect(mockSaveCache.mock.calls[0][0]).toBe('huevos');
    expect(mockSaveCache.mock.calls[0][2]).toEqual({ namespace: 'ES:' });
  });

  it('a translated `eggs` lands on the English `egg` FoodMapping key', () => {
    const q = { isBranded: false } as const;
    const key = deriveMappingCacheKey('eggs', null as never, q as never, 'eggs');
    expect(key).toBe(deriveMappingCacheKey('egg', null as never, q as never, 'egg'));
    expect(key).toBe('egg');
  });

  it('a Spanish cache hit under ES: is returned without calling the model', async () => {
    mockGetCache.mockResolvedValue({
      normalizedName: 'eggs', canonicalBase: 'egg', synonyms: [], prepPhrases: [], sizePhrases: [],
      isBranded: false, isMultiIngredient: false,
    });
    const r = await aiNormalizeIngredient('huevos', 'huevos', { spanish: true });
    expect(r.status).toBe('success');
    expect(mockCallStructuredLlm).not.toHaveBeenCalled();
  });
});
