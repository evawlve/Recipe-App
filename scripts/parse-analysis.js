const fs = require('fs');
const path = require('path');

const logPath = process.argv[2];
const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
const mappings = data.mappings || [];
console.log(`Total items: ${mappings.length}`);

let unmapped = 0;
let failed = 0;
let fallbacks = 0;
const issues = [];

mappings.forEach(item => {
  const conf = item.selectedCandidate?.confidence || 0;
  if (item.status === 'unmapped' || item.status === 'failed' || item.error || item.mappingStatus === 'unmapped' || conf < 0.95) {
    unmapped++;
    issues.push({
      original: item.originalIngredient || item.ingredient?.original || item.rawIngredient,
      reason: item.error || item.reason || item.status || `Low Confidence: ${conf}`
    });
  }
  if (item.fallbackUsed || item.aiFallbackUsed) {
    fallbacks++;
  }
});

console.log(`Unmapped/Failed: ${unmapped}`);
console.log(`Fallbacks used: ${fallbacks}`);

if (issues.length > 0) {
  console.log('\n--- ISSUES ---');
  issues.forEach(i => console.log(`- ${i.original}: ${i.reason}`));
} else {
  console.log('\nNo unmapped ingredients found!');
}
