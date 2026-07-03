/**
 * Ollama Quality Gate — Batch validator for ValidatedMapping candidates
 *
 * Sends batches of {normalizedForm, foodName, brandName} to local Ollama
 * for a quick PASS/FAIL semantic check before DB insertion.
 *
 * Throughput: ~20 items/sec on RTX 3090 with qwen2.5:14b (40 items per batch, ~2s per call)
 */

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen2.5:14b';

export const QUALITY_GATE_BATCH_SIZE = 40;

export interface QualityCheckItem {
  normalizedForm: string;
  foodName: string;
  brandName?: string | null;
}

/**
 * Validate a batch of items via Ollama. Returns boolean[] aligned with input.
 * Items that pass = true, items that fail = false.
 * On Ollama error, defaults all to PASS (fail-open to avoid blocking the pipeline).
 */
export async function checkBatchQuality(items: QualityCheckItem[]): Promise<boolean[]> {
  if (items.length === 0) return [];

  const itemLines = items.map((item, i) => {
    const brand = item.brandName ? ` (${item.brandName})` : '';
    return `${i + 1}. "${item.normalizedForm}" → "${item.foodName}"${brand}`;
  }).join('\n');

  const prompt = `For each item, decide if the left side (search query) reasonably describes the right side (food product).
PASS = they refer to the same food. FAIL = unrelated, non-food, or misleading.

${itemLines}

Respond with ONLY the number and PASS or FAIL, one per line. Example:
1. PASS
2. FAIL`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(`${OLLAMA_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: 'You are a concise food database quality checker. Only output numbered PASS/FAIL lines.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: items.length * 15,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`⚠️  Ollama HTTP ${response.status} — defaulting batch to PASS`);
      return new Array(items.length).fill(true);
    }

    const data = await response.json() as any;
    const content: string = data.choices?.[0]?.message?.content ?? '';

    // Parse results — default to PASS if we can't parse a line
    const results = new Array(items.length).fill(true);
    for (const line of content.split('\n')) {
      const match = line.match(/^(\d+)\.\s*(PASS|FAIL)/i);
      if (match) {
        const idx = parseInt(match[1], 10) - 1;
        if (idx >= 0 && idx < items.length) {
          results[idx] = match[2].toUpperCase() === 'PASS';
        }
      }
    }

    return results;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      console.error('⚠️  Ollama timeout (30s) — defaulting batch to PASS');
    } else {
      console.error(`⚠️  Ollama error: ${(err as Error).message} — defaulting batch to PASS`);
    }
    return new Array(items.length).fill(true);
  }
}

/**
 * Verify Ollama is reachable. Returns true if ready.
 */
export async function verifyOllamaReady(): Promise<boolean> {
  try {
    const baseUrl = OLLAMA_URL.replace('/v1', '');
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
