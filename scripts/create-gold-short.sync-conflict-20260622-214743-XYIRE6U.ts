#!/usr/bin/env ts-node

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract current failures from eval report into gold.short.csv
 * This creates a focused test set for rapid iteration
 */

async function main() {
  console.log('🔍 Creating gold.short.csv from latest eval failures\n');
  console.log('=' .repeat(80));
  
  // Find latest eval report
  const reportsDir = path.join(process.cwd(), 'reports');
  const failuresFile = path.join(reportsDir, 'eval-baseline-20251112-failures.json');
  
  if (!fs.existsSync(failuresFile)) {
    console.error(`❌ Failures file not found: ${failuresFile}`);
    console.error('Please run: npm run eval:analyze first');
    process.exit(1);
  }
  
  // Read failures
  const failuresData = JSON.parse(fs.readFileSync(failuresFile, 'utf-8'));
  const failureIds = new Set(failuresData.allFailures.map((f: any) => f.id));
  
  console.log(`\n📋 Found ${failureIds.size} failures in eval report`);
  
  // Read gold.v3.csv
  const goldPath = path.join(process.cwd(), 'eval', 'gold.v3.csv');
  const goldContent = fs.readFileSync(goldPath, 'utf-8');
  const lines = goldContent.split('\n');
  const header = lines[0];
  
  // Filter to only failure rows
  const failureLines = [header];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Extract ID (first field)
    const id = line.split(',')[0];
    if (failureIds.has(id)) {
      failureLines.push(line);
    }
  }
  
  // Write gold.short.csv
  const shortPath = path.join(process.cwd(), 'eval', 'gold.short.csv');
  fs.writeFileSync(shortPath, failureLines.join('\n') + '\n', 'utf-8');
  
  console.log(`\n✅ Created gold.short.csv with ${failureLines.length - 1} failure cases`);
  console.log(`   Location: ${shortPath}`);
  
  // Categorize failures
  const noMatch = failuresData.allFailures.filter((f: any) => f.top_food_name === null).length;
  const wrongMatch = failuresData.allFailures.filter((f: any) => f.top_food_name !== null).length;
  
  console.log('\n📊 Failure Breakdown:');
  console.log(`   NO MATCH:    ${noMatch} cases`);
  console.log(`   WRONG MATCH: ${wrongMatch} cases`);
  
  console.log('\n🎯 Top Patterns:');
  for (const [pattern, count] of Object.entries(failuresData.patterns)) {
    console.log(`   ${pattern}: ${count} cases`);
  }
  
  console.log('\n💡 Next Steps:');
  console.log('   1. Run: npm run eval:short');
  console.log('   2. Baseline should show 0% P@1 (all are failures)');
  console.log('   3. Fix issues phase by phase');
  console.log('   4. Track improvement on gold.short.csv');
  console.log('   5. Finally test on gold.v3.csv to check for regressions');
}

main().catch(console.error);

