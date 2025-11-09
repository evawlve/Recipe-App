import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { prisma } from '@/lib/db';
import { normalizeQuery, tokens } from '@/lib/search/normalize';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';
import { deriveServingOptions } from '@/lib/units/servings';
import { resolveGramsFromParsed } from '@/lib/nutrition/resolve-grams';
import { resolvePortion } from '@/lib/nutrition/portion';
import { ENABLE_PORTION_V2 } from '@/lib/flags';

interface GoldRow {
  id: string;
  raw_line: string;
  expected_food_name: string;
  expected_grams: string | number;
  expected_source: string;
  expected_source_tier?: string;
  form?: string;
  unit_type?: string;
  cuisine_tag?: string;
  difficulty?: string;
  expected_food_id_hint?: string;
  expected_unit_hint?: string;
  notes?: string;
}

function formatDateUTC(d = new Date()): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function regexOrSubstringMatch(text: string, hint?: string | null): boolean {
  if (!hint) return false;
  try {
    if (hint.includes('|') || hint.includes('.*')) {
      const re = new RegExp(hint, 'i');
      return re.test(text);
    }
  } catch {
    // ignore regex errors, fallback to substring
  }
  return text.toLowerCase().includes(hint.toLowerCase());
}

async function readGoldCsv(filePath: string): Promise<GoldRow[]> {
  const csv = await fs.promises.readFile(filePath, 'utf8');
  const parsed = Papa.parse<GoldRow>(csv, { header: true, skipEmptyLines: true });
  if (parsed.errors.length) {
    throw new Error(`CSV parse errors: ${parsed.errors.map(e => e.message).join('; ')}`);
  }
  return parsed.data;
}

async function findTopFoodCandidates(query: string) {
  const normalized = normalizeQuery(query);
  const ts = tokens(normalized);
  if (ts.length === 0) return [] as any[];

  const andORs = ts.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
      { aliases: { some: { alias: { contains: t, mode: 'insensitive' as const } } } },
    ]
  }));

  // Simple baseline: order by popularity desc, then verified first
  const foods = await prisma.food.findMany({
    where: { AND: andORs },
    take: 10,
    orderBy: [
      { verification: 'asc' },
      { popularity: 'desc' },
    ],
    select: {
      id: true,
      name: true,
      brand: true,
      source: true,
      verification: true,
      categoryId: true,
      kcal100: true,
      protein100: true,
      carbs100: true,
      fat100: true,
      densityGml: true,
      units: { select: { label: true, grams: true } },
      portionOverrides: ENABLE_PORTION_V2 
        ? { select: { unit: true, grams: true, label: true } }
        : false,
    }
  });

  return foods;
}

function isProvisionalResolution(parsed: ReturnType<typeof parseIngredientLine> | null, servingOptions: Array<{ label: string; grams: number }>, usedGrams: number | null): boolean {
  if (!parsed || usedGrams == null) return true;
  // If resolution used a labeled serving option, consider not provisional
  const lowerUnits = servingOptions.map(u => (u.label || '').toLowerCase());
  const rawUnit = parsed.unit?.toLowerCase() || '';
  return !lowerUnits.some(lbl => lbl.includes(rawUnit));
}

async function evaluateRow(row: GoldRow) {
  const parsed = parseIngredientLine(row.raw_line);
  const candidates = await findTopFoodCandidates(parsed ? parsed.name : row.raw_line);
  const top = candidates[0] || null;

  // P@1 calculation: match by expected_food_id_hint regex/substr OR expected_food_name substr
  let pAt1 = 0;
  if (top) {
    const nameBrand = `${top.brand ? top.brand + ' ' : ''}${top.name}`.trim();
    if (
      regexOrSubstringMatch(nameBrand, row.expected_food_id_hint || null) ||
      nameBrand.toLowerCase().includes((row.expected_food_name || '').toLowerCase())
    ) {
      pAt1 = 1;
    }
  }

  // Grams resolution
  let resolvedGrams: number | null = null;
  let provisional = true;
  if (parsed && top) {
    if (ENABLE_PORTION_V2) {
      // Use new 5-tier portion resolver (Sprint 3)
      const resolution = resolvePortion({
        food: {
          id: top.id,
          name: top.name,
          densityGml: top.densityGml ?? undefined,
          categoryId: top.categoryId ?? null,
          units: top.units?.map((u: { label: string; grams: number }) => ({ label: u.label, grams: u.grams })) ?? [],
          portionOverrides: (top as any).portionOverrides?.map((p: any) => ({ 
            unit: p.unit, 
            grams: p.grams, 
            label: p.label ?? null 
          })) ?? []
        },
        parsed,
        userOverrides: null
      });
      
      if (resolution.grams !== null && resolution.grams > 0) {
        resolvedGrams = resolution.grams;
        // Consider provisional if confidence < 0.8 or tier >= 4 (density/heuristic)
        provisional = resolution.confidence < 0.8 || resolution.tier >= 4;
      }
    } else {
      // Use old resolver (Sprint 0-2 baseline)
      const servingOptions = deriveServingOptions({
        units: top.units?.map((u: { label: string; grams: number }) => ({ label: u.label, grams: u.grams })) ?? [],
        densityGml: top.densityGml ?? undefined,
        categoryId: top.categoryId ?? null,
      });

      const g = resolveGramsFromParsed(parsed, servingOptions);
      if (g != null && g > 0) {
        resolvedGrams = g;
        provisional = isProvisionalResolution(parsed, servingOptions, g);
      }
    }
  }

  // Fallback: if still null and we have density + volume pattern, approximate via density (very rough)
  if (resolvedGrams == null && parsed && top?.densityGml) {
    const unit = (parsed.unit || '').toLowerCase();
    const qty = parsed.qty * (parsed.multiplier || 1);
    const CUP_ML = 240;
    const TBSP_ML = 14.787;
    const TSP_ML = 4.929;
    let ml = 0;
    if (unit.includes('cup')) ml = CUP_ML * qty;
    else if (unit.includes('tbsp')) ml = TBSP_ML * qty;
    else if (unit.includes('tsp')) ml = TSP_ML * qty;
    if (ml > 0) {
      resolvedGrams = ml * (top.densityGml as number);
      provisional = true; // density fallback is provisional
    }
  }

  const expectedG = Number(row.expected_grams);
  const mae = resolvedGrams != null ? Math.abs(resolvedGrams - expectedG) : expectedG; // if no resolution, count full error

  return {
    id: row.id,
    raw_line: row.raw_line,
    expected_food_name: row.expected_food_name,
    expected_grams: expectedG,
    top_food_name: top ? `${top.brand ? top.brand + ' ' : ''}${top.name}` : null,
    resolved_grams: resolvedGrams,
    pAt1,
    mae,
    provisional,
  };
}

async function main() {
  // Support both v1 and v2, default to v2 if it exists
  const goldFile = process.env.GOLD_FILE || 'gold.v2.csv';
  const goldPath = path.join(process.cwd(), 'eval', goldFile);
  
  // Fallback to v1 if v2 doesn't exist
  const finalPath = fs.existsSync(goldPath) 
    ? goldPath 
    : path.join(process.cwd(), 'eval', 'gold.v1.csv');
  
  const rows = await readGoldCsv(finalPath);
  const goldFileName = path.basename(finalPath);

  const results = [] as Array<Awaited<ReturnType<typeof evaluateRow>>>;

  for (const row of rows) {
    // Basic validation: required fields
    if (!row.id || !row.raw_line) continue;
    const r = await evaluateRow(row);
    results.push(r as any);
  }

  const total = results.length;
  const pAt1 = results.reduce((s, r) => s + r.pAt1, 0) / (total || 1);
  const mae = results.reduce((s, r) => s + r.mae, 0) / (total || 1);
  const provisionalRate = results.reduce((s, r) => s + (r.provisional ? 1 : 0), 0) / (total || 1);

  // Console summary
  // eslint-disable-next-line no-console
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // eslint-disable-next-line no-console
  console.log(`Eval Summary (${goldFileName})`);
  // eslint-disable-next-line no-console
  console.log(`Portion V2: ${ENABLE_PORTION_V2 ? '✅ ENABLED' : '❌ disabled'}`);
  // eslint-disable-next-line no-console
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  // eslint-disable-next-line no-console
  console.log(`Count: ${total}`);
  // eslint-disable-next-line no-console
  console.log(`P@1: ${(pAt1 * 100).toFixed(1)}%`);
  // eslint-disable-next-line no-console
  console.log(`MAE (g): ${mae.toFixed(1)}g`);
  // eslint-disable-next-line no-console
  console.log(`Provisional: ${(provisionalRate * 100).toFixed(1)}%`);

  // Write report
  const reportDir = path.join(process.cwd(), 'reports');
  await fs.promises.mkdir(reportDir, { recursive: true });
  const reportName = ENABLE_PORTION_V2 
    ? `eval-portion-v2-${formatDateUTC()}.json`
    : `eval-baseline-${formatDateUTC()}.json`;
  const reportPath = path.join(reportDir, reportName);
  const payload = {
    gold: goldFileName,
    portionV2Enabled: ENABLE_PORTION_V2,
    timestamp: new Date().toISOString(),
    totals: { count: total },
    metrics: {
      pAt1,
      mae,
      provisionalRate,
    },
    samples: results.slice(0, 20),
  };
  await fs.promises.writeFile(reportPath, JSON.stringify(payload, null, 2), 'utf8');

  // eslint-disable-next-line no-console
  console.log('Report:', path.relative(process.cwd(), reportPath));
}

main().then(() => prisma.$disconnect()).catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error('Eval failed:', err);
  await prisma.$disconnect();
  process.exit(1);
});
