#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';

interface QueueOptions {
  limit: number;
  output: string;
  source: 'ingredient-mappings' | 'food-popularity';
}

function parseQueueArgs(): QueueOptions {
  const args = process.argv.slice(2);
  let limit = 50;
  let output = 'data/fatsecret/cache-queue.jsonl';
  let source: QueueOptions['source'] = 'ingredient-mappings';

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--output=')) {
      output = arg.split('=')[1];
    } else if (arg.startsWith('--from=')) {
      const value = arg.split('=')[1];
      if (value === 'food-popularity') {
        source = 'food-popularity';
      }
    }
  }

  return { limit, output, source };
}

async function collectFromIngredientMappings(limit: number) {
  return prisma.$queryRaw<
    Array<{ foodId: string; uses: number; name: string; brand: string | null }>
  >`
    SELECT im."foodId" as "foodId",
           COUNT(*)::int as "uses",
           f."name" as "name",
           f."brand" as "brand"
    FROM "IngredientFoodMap" im
    JOIN "Food" f ON f."id" = im."foodId"
    GROUP BY im."foodId", f."name", f."brand"
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `;
}

async function collectFromFoodPopularity(limit: number) {
  return prisma.$queryRaw<
    Array<{ foodId: string; uses: number; name: string; brand: string | null }>
  >`
    SELECT f."id" as "foodId",
           f."popularity" as "uses",
           f."name" as "name",
           f."brand" as "brand"
    FROM "Food" f
    ORDER BY f."popularity" DESC NULLS LAST
    LIMIT ${limit}
  `;
}

async function main() {
  const options = parseQueueArgs();
  const outputPath = path.resolve(options.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const rows =
    options.source === 'food-popularity'
      ? await collectFromFoodPopularity(options.limit)
      : await collectFromIngredientMappings(options.limit);

  const payload = rows.map((row) => ({
    foodId: row.foodId,
    name: row.name,
    brand: row.brand,
    weight: row.uses,
    source: options.source,
  }));

  const stream = fs.createWriteStream(outputPath, { flags: 'w' });
  for (const entry of payload) {
    stream.write(`${JSON.stringify(entry)}\n`);
  }
  stream.end();

  logger.info(
    { output: outputPath, count: payload.length, source: options.source },
    'Wrote FatSecret cache hydration queue',
  );
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret cache queue failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
