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
  outputPath?: string;
}

function parseArgs(): CliOptions {
  const options: CliOptions = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output' && args[i + 1]) {
      options.outputPath = path.resolve(args[i + 1]);
      i += 1;
    } else if (arg.startsWith('--output=')) {
      options.outputPath = path.resolve(arg.split('=')[1]);
    }
  }
  return options;
}

type CountRow = { count: bigint };

async function main() {
  const options = parseArgs();
  const lines: string[] = [];
  const logLine = (text = '') => {
    lines.push(text);
    console.log(text);
  };

  const totalIngredientMaps = await prisma.ingredientFoodMap.count();

  const [mappedMapRows] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count
    FROM "IngredientFoodMap" m
    WHERE m."fatsecretFoodId" IS NOT NULL
  `;
  const mappedMaps = Number(mappedMapRows?.count ?? 0n);

  const [totalIngredientRows] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM "Ingredient"
  `;
  const totalIngredientCount = Number(totalIngredientRows?.count ?? 0n);

  const [mappedIngredientRows] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT m."ingredientId")::bigint AS count
    FROM "IngredientFoodMap" m
    WHERE m."fatsecretFoodId" IS NOT NULL
  `;
  const mappedIngredientCount = Number(mappedIngredientRows?.count ?? 0n);

  const [mappedLegacyRows] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT m."ingredientId")::bigint AS count
    FROM "IngredientFoodMap" m
    WHERE m."foodId" IS NOT NULL
  `;
  const mappedLegacyIngredients = Number(mappedLegacyRows?.count ?? 0n);

  const [mappedAnyRows] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(DISTINCT m."ingredientId")::bigint AS count
    FROM "IngredientFoodMap" m
    WHERE m."fatsecretFoodId" IS NOT NULL OR m."foodId" IS NOT NULL
  `;
  const mappedAnyIngredients = Number(mappedAnyRows?.count ?? 0n);

  const [rowsLegacy] = await prisma.$queryRaw<CountRow[]>`
    SELECT COUNT(*)::bigint AS count FROM "IngredientFoodMap" WHERE "foodId" IS NOT NULL
  `;
  const mappedLegacyRowsCount = Number(rowsLegacy?.count ?? 0n);

  const unmappedIngredients = Math.max(0, totalIngredientCount - mappedAnyIngredients);

  logLine('FatSecret coverage report');
  logLine('=========================');
  logLine(`IngredientFoodMap rows    : ${totalIngredientMaps}`);
  logLine(`Mapped rows (fatsecret)   : ${mappedMaps}`);
  logLine(`Mapped rows (legacy)      : ${mappedLegacyRowsCount}`);
  logLine(
    `Row coverage (fatsecret)  : ${
      totalIngredientMaps === 0 ? '0.00' : ((mappedMaps / totalIngredientMaps) * 100).toFixed(2)
    }%`,
  );
  logLine('');
  logLine(`Total ingredients         : ${totalIngredientCount}`);
  logLine(`Ingredients w/ fatsecret  : ${mappedIngredientCount}`);
  logLine(`Ingredients w/ legacy     : ${mappedLegacyIngredients}`);
  logLine(`Ingredients mapped (any)  : ${mappedAnyIngredients}`);
  logLine(`Unmapped ingredients      : ${unmappedIngredients}`);
  logLine(
    `Ingredients coverage (fatsecret): ${
      totalIngredientCount === 0 ? '0.00' : ((mappedIngredientCount / totalIngredientCount) * 100).toFixed(2)
    }%`,
  );
  logLine('');
  logLine(
    `Ingredients coverage (any): ${
      totalIngredientCount === 0 ? '0.00' : ((mappedAnyIngredients / totalIngredientCount) * 100).toFixed(2)
    }%`,
  );

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, lines.join('\n'), 'utf-8');
    console.log(`\nWrote coverage report to ${options.outputPath}`);
  }
}

main()
  .catch((error) => {
    console.error('fatsecret-coverage-report failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
