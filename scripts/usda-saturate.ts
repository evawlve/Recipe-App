import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/db';
import { DEFAULT_SATURATION_FILTERS, UsdaSaturationFilters } from '../src/ops/usda/config';
import { normalizeUsdaRowToPer100g, fdcToUsdaRow } from '../src/ops/usda/normalize';
import { canonicalName, macroFingerprintSaturation } from '../src/ops/usda/dedupe';
import { mapUsdaToCategory } from '../src/ops/usda/category-map';
import { CATEGORY_DEFAULTS } from '../src/ops/curated/category-defaults';
import { generateAliasesForFood, canonicalAlias } from '../src/ops/foods/alias-rules';

type RawUsda = any; // your existing type (FDC row)
type Options = {
  file?: string;            // bulk JSON/JSONL file (preferred)
  keywords?: string[];      // optional keyword sweep on a pre-filtered dataset
  maxPerKeyword?: number;
  filters?: UsdaSaturationFilters;
  dryRun?: boolean;
};

function matchesFilters(row: RawUsda, f: UsdaSaturationFilters) {
  const dt = (row.dataType || row.data_type || '').toString();
  if (!f.includeDataTypes.some(t => dt.includes(t))) return false;
  const name = `${row.description||row.name||''}`.toLowerCase();
  const cat  = `${row.foodCategory || row.category || ''}`.toLowerCase();
  if (f.excludeIfNameHas.some(x => name.includes(x))) return false;
  if (f.excludeIfCategoryHas.some(x => cat.includes(x))) return false;
  return true;
}

async function upsertFood(per100: any, meta: {name: string; brand?: string|null; categoryId: string|null}) {
  const idName = canonicalName(meta.name).replace(/\s+/g,'_').slice(0,80);
  const existing = await prisma.food.findFirst({
    where: {
      OR: [
        { name: meta.name },
        { aliases: { some: { alias: canonicalName(meta.name) } } }
      ]
    }
  });

  const units = CATEGORY_DEFAULTS[meta.categoryId || '']?.units ?? [];
  const data = {
    name: meta.name,
    brand: meta.brand ?? null,
    categoryId: meta.categoryId,
    source: 'usda' as const,
    verification: 'verified' as const,
    densityGml: CATEGORY_DEFAULTS[meta.categoryId || '']?.densityGml ?? null,
    kcal100: per100.kcal100, protein100: per100.protein100, carbs100: per100.carbs100, fat100: per100.fat100,
    fiber100: per100.fiber100 ?? null, sugar100: per100.sugar100 ?? null,
    popularity: 50,
    units: units.length ? { create: units } : undefined,
  };

  if (!existing) {
    const created = await prisma.food.create({ data });
    
    // Create aliases for the new food
    const extraAliases = [canonicalAlias(meta.name), ...generateAliasesForFood(meta.name, meta.categoryId)];
    await prisma.foodAlias.createMany({
      data: extraAliases.map(alias => ({ foodId: created.id, alias })),
      skipDuplicates: true
    });
    
    return { created: 1, updated: 0 };
  } else {
    await prisma.food.update({ where: { id: existing.id }, data });
    return { created: 0, updated: 1 };
  }
}

async function processRows(rows: RawUsda[], opt: Options) {
  const f = opt.filters || DEFAULT_SATURATION_FILTERS;
  let created=0, updated=0, skipped=0, duped=0;

  for (const row of rows) {
    if (!matchesFilters(row, f)) { skipped++; continue; }
    
    // Convert FDC format to UsdaRow format
    const usdaRow = fdcToUsdaRow(row);
    if (!usdaRow) { skipped++; continue; }
    
    const per100 = normalizeUsdaRowToPer100g(usdaRow); // you already have clamps here
    if (!per100) { skipped++; continue; }
    if (per100.kcal100 < f.kcalMin || per100.kcal100 > f.kcalMax) { skipped++; continue; }

    const metaName = (row.description || row.name || '').trim();
    if (!metaName) { skipped++; continue; }

    const cat = mapUsdaToCategory(metaName, row.foodCategory || row.category) || null;

    // Duplicate check by name+macro fingerprint
    const fp = macroFingerprintSaturation(per100);
    const canonical = canonicalName(metaName);
    const exists = await prisma.food.findFirst({
      where: {
        AND: [
          { OR: [{ name: metaName }, { aliases: { some: { alias: canonical } } }] },
          { kcal100: { gte: per100.kcal100-10, lte: per100.kcal100+10 } },
          { protein100: { gte: per100.protein100-2, lte: per100.protein100+2 } },
          { carbs100: { gte: per100.carbs100-2, lte: per100.carbs100+2 } },
          { fat100: { gte: per100.fat100-2, lte: per100.fat100+2 } },
        ]
      }
    });
    if (exists) { duped++; continue; }

    if (opt.dryRun) { created++; continue; }
    const res = await upsertFood(per100, { name: metaName, brand: null, categoryId: cat });
    created += res.created; updated += res.updated;
  }

  return { created, updated, skipped, duped };
}

async function readJsonOrJsonl(filePath: string) {
  const full = path.resolve(filePath);
  const text = fs.readFileSync(full, 'utf-8');
  if (filePath.endsWith('.jsonl') || filePath.endsWith('.ndjson')) {
    return text.trim().split('\n').map(line => JSON.parse(line));
  }
  return JSON.parse(text);
}

(async function main(){
  const args = process.argv.slice(2);
  const fileArg = args.find(a => a.startsWith('--file='))?.split('=')[1];
  const dry = args.includes('--dry-run');
  const maxPerKeyword = Number(args.find(a => a.startsWith('--max-per-keyword='))?.split('=')[1] || '50');
  const kwArg = args.find(a => a.startsWith('--keywords='))?.split('=')[1];
  const keywords = kwArg ? kwArg.split(',').map(s=>s.trim()).filter(Boolean) : [];

  if (!fileArg) {
    console.error('Usage: ts-node scripts/usda-saturate.ts --file=./data/usda/fdc.json[.jsonl] [--dry-run] [--keywords=rice,oil,egg] [--max-per-keyword=50]');
    process.exit(1);
  }

  const allRows = await readJsonOrJsonl(fileArg);

  let rowsToProcess = allRows;
  if (keywords.length) {
    rowsToProcess = keywords.flatMap(kw => {
      const kwRows = allRows.filter((r:any)=>`${r.description||r.name||''}`.toLowerCase().includes(kw.toLowerCase()));
      return kwRows.slice(0, maxPerKeyword);
    });
  }

  const res = await processRows(rowsToProcess, { file: fileArg, keywords, maxPerKeyword, dryRun: dry });
  console.log({ ...res, totalInput: rowsToProcess.length });
})();
