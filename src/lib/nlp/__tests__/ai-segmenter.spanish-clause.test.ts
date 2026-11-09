/** s453 A2 pins: the Spanish clause is appended only for Spanish lines AND a set SEG_ES_VARIANT. */
import { segmenterSystemPrompt, SEGMENT_SYSTEM_PROMPT } from '../ai-segmenter';

const V1 =
  'SPANISH INPUT: "con" means "with" and "y" means "and". Apply the two rules above to the English meaning: split two real foods; keep one named dish whole (arroz con pollo, arroz con leche, chile con carne, leche con chocolate, café con leche, huevos rancheros = 1 item).';

describe('segmenterSystemPrompt', () => {
  const saved = process.env.SEG_ES_VARIANT;
  afterEach(() => {
    if (saved === undefined) delete process.env.SEG_ES_VARIANT;
    else process.env.SEG_ES_VARIANT = saved;
  });

  it('English line + V1 => master prompt', () => {
    process.env.SEG_ES_VARIANT = 'V1';
    expect(segmenterSystemPrompt('toast with butter')).toBe(SEGMENT_SYSTEM_PROMPT);
  });
  it('Spanish line + unset => master prompt', () => {
    delete process.env.SEG_ES_VARIANT;
    expect(segmenterSystemPrompt('arroz con frijoles')).toBe(SEGMENT_SYSTEM_PROMPT);
  });
  it('Spanish line + V1 => master + newline + V1 text', () => {
    process.env.SEG_ES_VARIANT = 'V1';
    expect(segmenterSystemPrompt('arroz con frijoles')).toBe(`${SEGMENT_SYSTEM_PROMPT}\n${V1}`);
  });
});
