/**
 * Parser Performance Benchmark
 * 
 * Runs parser over 5k random-ish lines and measures performance.
 * Target: p95 < 0.5 ms/line on dev box.
 * 
 * Usage: npm run parser:bench
 */

import { performance } from 'perf_hooks';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import * as fs from 'fs';
import * as path from 'path';

// Generate test cases (mix of real-world patterns)
function generateTestCases(count: number): string[] {
  const units = ['cup', 'tbsp', 'tsp', 'g', 'oz', 'lb', 'piece', 'clove', 'leaf'];
  const ingredients = ['flour', 'sugar', 'salt', 'pepper', 'olive oil', 'butter', 'eggs', 'milk', 'chicken', 'garlic', 'onion', 'tomato'];
  const qualifiers = ['large', 'small', 'diced', 'chopped', 'minced', 'boneless', 'skinless'];
  const fractions = ['½', '¼', '¾', '⅓'];
  
  const cases: string[] = [];
  
  for (let i = 0; i < count; i++) {
    const pattern = i % 10;
    let line = '';
    
    switch (pattern) {
      case 0: // Simple: "2 cups flour"
        line = `${Math.floor(Math.random() * 5) + 1} ${units[Math.floor(Math.random() * units.length)]} ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
      case 1: // Fraction: "2½ cups flour"
        line = `${Math.floor(Math.random() * 3) + 1}${fractions[Math.floor(Math.random() * fractions.length)]} ${units[Math.floor(Math.random() * units.length)]} ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
      case 2: // Range: "2-3 eggs"
        line = `${Math.floor(Math.random() * 3) + 1}-${Math.floor(Math.random() * 3) + 4} ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
      case 3: // Qualifier: "3 large boneless chicken breasts"
        line = `${Math.floor(Math.random() * 3) + 1} ${qualifiers[Math.floor(Math.random() * qualifiers.length)]} ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
      case 4: // Unit hint: "2 egg yolks"
        line = `${Math.floor(Math.random() * 3) + 1} egg ${['yolks', 'whites'][Math.floor(Math.random() * 2)]}`;
        break;
      case 5: // Multiplier: "2 x 200g chicken"
        line = `${Math.floor(Math.random() * 3) + 1} x ${Math.floor(Math.random() * 200) + 100}g ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
      case 6: // Parentheses: "1 cup onion (diced)"
        line = `${Math.floor(Math.random() * 3) + 1} ${units[Math.floor(Math.random() * units.length)]} ${ingredients[Math.floor(Math.random() * ingredients.length)]} (${qualifiers[Math.floor(Math.random() * qualifiers.length)]})`;
        break;
      case 7: // Comma: "2 cloves garlic, minced"
        line = `${Math.floor(Math.random() * 3) + 1} cloves ${ingredients[Math.floor(Math.random() * ingredients.length)]}, ${qualifiers[Math.floor(Math.random() * qualifiers.length)]}`;
        break;
      case 8: // Noise: "---" or "to taste"
        line = ['---', 'to taste salt', ''][Math.floor(Math.random() * 3)];
        break;
      case 9: // Complex: "1½-2 tsp vanilla extract"
        line = `1${fractions[Math.floor(Math.random() * fractions.length)]}-${Math.floor(Math.random() * 3) + 2} ${units[Math.floor(Math.random() * units.length)]} ${ingredients[Math.floor(Math.random() * ingredients.length)]}`;
        break;
    }
    
    cases.push(line);
  }
  
  return cases;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

async function main() {
  console.log('🚀 Starting parser benchmark...\n');
  
  const testCases = generateTestCases(5000);
  const timings: number[] = [];
  let successCount = 0;
  let nullCount = 0;
  
  console.log(`📊 Running ${testCases.length} test cases...\n`);
  
  // Warmup
  for (let i = 0; i < 100; i++) {
    parseIngredientLine(testCases[i % testCases.length]);
  }
  
  // Benchmark
  for (const line of testCases) {
    const start = performance.now();
    const result = parseIngredientLine(line);
    const end = performance.now();
    
    const duration = end - start;
    timings.push(duration);
    
    if (result !== null) {
      successCount++;
    } else {
      nullCount++;
    }
  }
  
  // Calculate statistics
  const total = timings.reduce((a, b) => a + b, 0);
  const avg = total / timings.length;
  const p50 = percentile(timings, 50);
  const p95 = percentile(timings, 95);
  const p99 = percentile(timings, 99);
  const min = Math.min(...timings);
  const max = Math.max(...timings);
  
  const target = 0.5; // ms
  const passed = p95 < target;
  
  console.log('📈 Results:');
  console.log(`  Total cases: ${testCases.length}`);
  console.log(`  Successful parses: ${successCount}`);
  console.log(`  Null results: ${nullCount}`);
  console.log(`  Total time: ${total.toFixed(2)} ms`);
  console.log(`  Average: ${avg.toFixed(4)} ms/line`);
  console.log(`  Min: ${min.toFixed(4)} ms`);
  console.log(`  p50 (median): ${p50.toFixed(4)} ms`);
  console.log(`  p95: ${p95.toFixed(4)} ms ${p95 < target ? '✅' : '❌'} (target: < ${target} ms)`);
  console.log(`  p99: ${p99.toFixed(4)} ms`);
  console.log(`  Max: ${max.toFixed(4)} ms`);
  console.log(`\n${passed ? '✅' : '❌'} Benchmark ${passed ? 'PASSED' : 'FAILED'}: p95 ${p95.toFixed(4)} ms ${passed ? '<' : '>='} ${target} ms\n`);
  
  // Save report
  const report = {
    timestamp: new Date().toISOString(),
    totalCases: testCases.length,
    successCount,
    nullCount,
    stats: {
      total: total,
      avg,
      min,
      p50,
      p95,
      p99,
      max
    },
    target,
    passed
  };
  
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const reportPath = path.join(process.cwd(), 'reports', `parser-bench-${dateStr}.json`);
  
  // Ensure reports directory exists
  const reportsDir = path.dirname(reportPath);
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }
  
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`📄 Report saved to: ${reportPath}`);
  
  process.exit(passed ? 0 : 1);
}

main().catch(console.error);

