import 'dotenv/config';
import {
  FATSECRET_CACHE_AI_MODEL,
  OPENAI_API_BASE_URL,
} from './config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

type CandidateInput = {
  id: string;
  name: string;
  brandName?: string | null;
  foodType?: string | null;
  score: number;
};

type AiPick =
  | {
    status: 'success';
    id: string;
    confidence: number;
    rationale?: string | null;
  }
  | {
    status: 'error';
    reason: string;
  };

const RESPONSE_SCHEMA = {
  name: 'fatsecret_candidate_pick',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      confidence: { type: 'number' },
      rationale: { type: ['string', 'null'] },
      error: { type: ['string', 'null'] },
    },
    required: ['id', 'confidence', 'rationale', 'error'],
  },
  strict: true,
};

const SYSTEM_PROMPT = [
  'You are an ingredient-to-food mapper. Pick the single best FatSecret candidate.',
  'Only choose from the provided candidate list. Return valid JSON.',
  'Use the ingredient text, category hints (meat type, fresh vs canned, cube vs broth), and prefer generic/raw matches over branded unless explicitly asked.',
].join(' ');

function buildUserPrompt(rawLine: string, candidates: CandidateInput[]): string {
  const lines: string[] = [];
  lines.push(`Ingredient: ${rawLine}`);
  lines.push('Candidates:');
  candidates.forEach((c, idx) => {
    lines.push(`${idx + 1}. id=${c.id}, name=${c.name}, brand=${c.brandName ?? 'generic'}, type=${c.foodType ?? 'n/a'}, score=${c.score.toFixed(3)}`);
  });
  lines.push('Rules: choose ONE id, include confidence 0-1 and a short rationale; if none fit well, return {"error":"reason"}.');
  return lines.join('\n');
}

export async function rerankFatsecretCandidates(
  rawLine: string,
  candidates: CandidateInput[],
  minAiConfidence = 0.75,
): Promise<AiPick> {
  if (!OPENAI_API_KEY) {
    return { status: 'error', reason: 'OPENAI_API_KEY missing' };
  }
  if (candidates.length === 0) {
    return { status: 'error', reason: 'no candidates' };
  }
  const prompt = buildUserPrompt(rawLine, candidates);

  // DEBUG: Log candidates for analysis
  console.log('\n🤖 AI Rerank Input:');
  console.log(`  Query: "${rawLine}"`);
  console.log('  Candidates:');
  candidates.forEach((c, idx) => {
    console.log(`    ${idx + 1}. [${c.id}] "${c.name}" (Score: ${c.score.toFixed(3)})`);
  });

  try {
    const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: FATSECRET_CACHE_AI_MODEL,
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      return { status: 'error', reason: 'empty AI response' };
    }
    const parsed = JSON.parse(content);
    if (parsed.error) {
      return { status: 'error', reason: parsed.error };
    }
    if (typeof parsed.id !== 'string' || typeof parsed.confidence !== 'number') {
      return { status: 'error', reason: 'invalid AI response schema' };
    }
    if (parsed.confidence < minAiConfidence) {
      return { status: 'error', reason: 'ai_confidence_below_threshold' };
    }
    if (!candidates.find((c) => c.id === parsed.id)) {
      return { status: 'error', reason: 'ai_selected_unknown_id' };
    }
    return {
      status: 'success',
      id: parsed.id,
      confidence: parsed.confidence,
      rationale: parsed.rationale ?? null,
    };
  } catch (err) {
    return { status: 'error', reason: (err as Error).message };
  }
}
