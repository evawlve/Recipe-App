#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { FATSECRET_CACHE_MAX_AGE_MINUTES } from '../src/lib/fatsecret/config';

const MS_PER_MINUTE = 60 * 1000;

interface CliOptions {
  outputPath?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output') {
      const next = args[i + 1];
      if (next) {
        options.outputPath = path.resolve(next);
        i += 1;
      }
    } else if (arg.startsWith('--output=')) {
      options.outputPath = path.resolve(arg.split('=')[1]);
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();
  const [
    totalFoods,
    servingCount,
    aliasCount,
    countsBySource,
    countsByFoodType,
    missingNutrients,
    missingServings,
    staleCount,
  ] = await Promise.all([
    prisma.fatSecretFoodCache.count(),
    prisma.fatSecretServingCache.count(),
    prisma.fatSecretFoodAlias.count(),
    prisma.$queryRaw<{ source: string | null; count: bigint }[]>`
      SELECT "source", COUNT(*)::bigint AS count
      FROM "FatSecretFoodCache"
      GROUP BY "source"
      ORDER BY COUNT(*) DESC
    `,
    prisma.$queryRaw<{ foodType: string | null; count: bigint }[]>`
      SELECT "foodType", COUNT(*)::bigint AS count
      FROM "FatSecretFoodCache"
      GROUP BY "foodType"
      ORDER BY COUNT(*) DESC
    `,
    prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT COUNT(*)::bigint as count FROM "FatSecretFoodCache" WHERE "nutrientsPer100g" IS NULL OR "nutrientsPer100g"::text = '{}'`,
    prisma.$queryRaw<
      { missing_servings: bigint }[]
    >`SELECT COUNT(DISTINCT f.id)::bigint AS missing_servings
       FROM "FatSecretFoodCache" f
       LEFT JOIN "FatSecretServingCache" s ON s."foodId" = f.id
       WHERE s.id IS NULL`,
    prisma.fatSecretFoodCache.count({
      where: {
        syncedAt: {
          lt: new Date(Date.now() - FATSECRET_CACHE_MAX_AGE_MINUTES * MS_PER_MINUTE),
        },
      },
    }),
  ]);

  const topMissingNutrients = await prisma.$queryRaw<
    { id: string; name: string; brand: string | null }[]
  >`SELECT id, name, "brandName" as brand
     FROM "FatSecretFoodCache"
     WHERE "nutrientsPer100g" IS NULL OR "nutrientsPer100g"::text = '{}'
     ORDER BY "syncedAt" ASC
     LIMIT 10`;

  const topMissingServings = await prisma.$queryRaw<
    { id: string; name: string; brand: string | null }[]
  >`SELECT f.id, f.name, f."brandName" as brand
     FROM "FatSecretFoodCache" f
     LEFT JOIN "FatSecretServingCache" s ON s."foodId" = f.id
     WHERE s.id IS NULL
     ORDER BY f."syncedAt" ASC
     LIMIT 10`;

  const lines: string[] = [];
  const push = (text = '') => {
    lines.push(text);
    console.log(text);
  };

  const formatGroup = (
    label: string,
    rows: { source?: string | null; foodType?: string | null; count: bigint }[],
  ) => {
    if (rows.length === 0) return;
    push(label);
    rows.forEach((row) => {
      const name = (row.source ?? row.foodType ?? 'unknown') || 'unknown';
      push(`  ${name.padEnd(20)} ${Number(row.count).toString().padStart(6)}`);
    });
    push();
  };

  push('FatSecret cache summary');
  push('=======================');
  push(`Foods cached          : ${totalFoods}`);
  push(`Servings cached       : ${servingCount}`);
  push(`Aliases cached        : ${aliasCount}`);
  push(`Missing nutrients     : ${Number(missingNutrients[0]?.count ?? 0n)}`);
  push(`Missing servings      : ${Number(missingServings[0]?.missing_servings ?? 0n)}`);
  push(`Stale (needs hydrate) : ${staleCount}`);
  push();

  formatGroup('By source', countsBySource);
  formatGroup('By food type', countsByFoodType);

  const printList = (label: string, rows: { id: string; name: string; brand: string | null }[]) => {
    if (rows.length === 0) return;
    push(label);
    rows.forEach((row) => {
      const display = row.brand ? `${row.name} (${row.brand})` : row.name;
      push(`  ${row.id} - ${display}`);
    });
    push();
  };

  printList('Top missing nutrient foods', topMissingNutrients);
  printList('Top foods with zero servings', topMissingServings);

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, lines.join('\n'), 'utf-8');
    console.log(`\nWrote report to ${options.outputPath}`);
  }
}

main()
  .catch((error) => {
    console.error('fatsecret-cache-report failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
