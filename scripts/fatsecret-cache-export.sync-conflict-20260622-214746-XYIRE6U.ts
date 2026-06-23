#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

interface CliOptions {
  outputPath: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let outputPath = 'data/fatsecret/cache-seed.json';
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output' && args[i + 1]) {
      outputPath = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--output=')) {
      outputPath = arg.split('=')[1];
    }
  }
  const resolved = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return { outputPath: resolved };
}

async function main() {
  const { outputPath } = parseArgs();

  const foods = await prisma.fatSecretFoodCache.findMany({
    include: {
      servings: true,
      aliases: true,
      densityEstimates: true,
    },
    orderBy: { id: 'asc' },
  });

  const payload = foods.map((food) => ({
    ...food,
    servings: food.servings,
    aliases: food.aliases,
    densityEstimates: food.densityEstimates,
  }));

  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    `Exported ${payload.length} FatSecret cache foods (with servings/aliases/density) to ${outputPath}`,
  );
}

main()
  .catch((error) => {
    console.error('fatsecret-cache-export failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
