#!/usr/bin/env ts-node

import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { z } from 'zod';
import { CuratedPackSchema } from '@/ops/curated/seed-schema';
import { CATEGORY_DEFAULTS } from '@/ops/curated/category-defaults';

const Row = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  brand: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  densityGml: z.string().optional().nullable(),
  kcal100: z.string().optional().nullable(),
  protein100: z.string().optional().nullable(),
  carbs100: z.string().optional().nullable(),
  fat100: z.string().optional().nullable(),
  fiber100: z.string().optional().nullable(),
  sugar100: z.string().optional().nullable(),
  aliases: z.string().optional().nullable(),
  verification: z.string().optional().nullable(), // verified|unverified|suspect
  popularity: z.string().optional().nullable(),
  units: z.string().optional().nullable(), // JSON or blank
});

function numOrNull(s?: string | null) {
  if (s == null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseUnits(raw: string | null | undefined, categoryId?: string | null) {
  if (raw && raw.trim().length) {
    try { return JSON.parse(raw); } catch {}
  }
  if (categoryId && CATEGORY_DEFAULTS[categoryId]?.units) {
    return CATEGORY_DEFAULTS[categoryId]!.units;
  }
  return [];
}

(async function main() {
  const csvPath = process.argv[2];
  const outPath = process.argv[3] || 'data/curated/pack-generated.json';
  if (!csvPath) {
    console.error('Usage: ts-node --transpile-only scripts/curated-from-csv.ts <input.csv> [output.json]');
    process.exit(1);
  }
  const csv = fs.readFileSync(path.resolve(csvPath), 'utf-8');
  const { data, errors } = Papa.parse(csv, { header: true, skipEmptyLines: true });
  if (errors.length) {
    console.error('CSV parse errors:', errors.slice(0,3));
    process.exit(1);
  }
  const rows = (data as any[]).map((r) => Row.parse(r));

  const items = rows.map((r) => {
    const categoryId = r.categoryId ?? null;
    const density = numOrNull(r.densityGml) ?? CATEGORY_DEFAULTS[categoryId ?? '']?.densityGml ?? null;
    const aliases = (r.aliases ?? '')
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

    const obj = {
      id: r.id,
      name: r.name,
      brand: r.brand ?? null,
      categoryId,
      densityGml: density,
      kcal100: numOrNull(r.kcal100) ?? 0,
      protein100: numOrNull(r.protein100) ?? 0,
      carbs100: numOrNull(r.carbs100) ?? 0,
      fat100: numOrNull(r.fat100) ?? 0,
      fiber100: numOrNull(r.fiber100),
      sugar100: numOrNull(r.sugar100),
      units: parseUnits(r.units ?? null, categoryId),
      aliases,
      verification: (r.verification as any) ?? 'verified',
      popularity: Number(numOrNull(r.popularity) ?? 1),
    };
    return obj;
  });

  const pack = {
    meta: { name: path.basename(outPath, '.json'), version: 1 },
    items,
  };

  // Validate with your CuratedPackSchema
  const valid = CuratedPackSchema.parse(pack);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(valid, null, 2));
  console.log(`Wrote ${valid.items.length} items → ${outPath}`);
})();
