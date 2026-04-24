import * as fs from 'fs';

const logFile = 'C:\\Dev\\Recipe App\\logs\\mapping-summary-2026-04-02T00-12-17.txt';
// It might be utf16le because of powershell or utf8. Let's try reading as utf8 first.
const content = fs.readFileSync(logFile, 'utf8');
const lines = content.replace(/\r\n/g, '\n').replace(/\0/g, '').split('\n');

const fullPipelineItems: Record<string, { count: number, mappedTo: string }> = {};
const earlyCacheItems: Set<string> = new Set();
const normalizedCacheItems: Set<string> = new Set();

for (const line of lines) {
  const match = line.match(/^\s*[✓✗]\s*(?:\{(.*?)\})?\s*\[.*?\]\s+"([^"]+)"\s*(?:→|->)\s*"([^"]*)"/);
  if (!match) continue;
  
  const type = match[1]; // full_pipeline, early_cache, normalized_cache
  const raw = match[2];
  const mapped = match[3];

  if (type === 'full_pipeline') {
    if (!fullPipelineItems[raw]) {
      fullPipelineItems[raw] = { count: 0, mappedTo: mapped };
    }
    fullPipelineItems[raw].count++;
  } else if (type === 'early_cache') {
    earlyCacheItems.add(raw);
  } else if (type === 'normalized_cache') {
    normalizedCacheItems.add(raw);
  }
}

// Any items in full_pipeline that NEVER hit either cache AND appeared multiple times?
const misses = Object.entries(fullPipelineItems)
  .filter(([raw, data]) => data.count > 1 && !earlyCacheItems.has(raw) && !normalizedCacheItems.has(raw))
  .sort((a, b) => b[1].count - a[1].count);

console.log('--- REPEATED FULL PIPELINE MISSES (NEVER CACHED) ---');
for (const [raw, data] of misses.slice(0, 50)) {
  console.log(`[${data.count}x] "${raw}" -> "${data.mappedTo}"`);
}

console.log('\n--- TOP OVERALL FULL PIPELINE CALLS (MIGHT HAVE EVENTUALLY CACHED) ---');
const allFull = Object.entries(fullPipelineItems)
  .sort((a, b) => b[1].count - a[1].count);
for (const [raw, data] of allFull.slice(0, 20)) {
  const cached = earlyCacheItems.has(raw) || normalizedCacheItems.has(raw) ? ' (Cached later)' : '';
  console.log(`[${data.count}x] "${raw}" -> "${data.mappedTo}"${cached}`);
}
