#!/usr/bin/env ts-node

/**
 * Debug helper to map arbitrary ingredient lines via FatSecret and dump results.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/fatsecret-debug-map.ts "10 parsley sprigs" "1 smoked chicken sausage" "1 cube chicken bouillon" --output=data/fatsecret/debug-map.json
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { mapIngredientWithFatsecret } from '@/lib/fatsecret/map-ingredient';
import { prisma } from '@/lib/db';

interface CliOptions {
  lines: string[];
  outputPath?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const lines: string[] = [];
  let outputPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' && args[i + 1]) {
      outputPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      outputPath = path.resolve(arg.split('=')[1]);
    } else {
      lines.push(arg);
    }
  }
  return { lines, outputPath };
}

async function main() {
  const { lines, outputPath } = parseArgs();
  if (lines.length === 0) {
    console.error('Provide ingredient lines as arguments');
    process.exit(1);
  }

  const results: Array<{
    line: string;
    result: any;
    error?: string;
  }> = [];

  for (const line of lines) {
    try {
      const res = await mapIngredientWithFatsecret(line, { minConfidence: 0 });
      results.push({ line, result: res });
    } catch (err) {
      results.push({ line, result: null, error: (err as Error).message });
    }
  }

  // Print to console in a powershell-friendly way
  for (const row of results) {
    console.log('\n===', row.line, '===');
    console.dir(row, { depth: null });
  }

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
    console.log(`\nWrote results to ${outputPath}`);
  }
}

main()
  .catch((error) => {
    console.error('fatsecret-debug-map failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
