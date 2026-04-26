/**
 * investigate-nutrition.ts
 * 
 * Investigates:
 * 1. WHY 91% of VMs have no calorie data (cache shape, null fields, wrong keys)
 * 2. PATTERN analysis of the 664 AI-flagged bad entries
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const prisma = new PrismaClient();

function section(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function main() {
  // ── 1. FatSecret nutrientsPer100g shape ───────────────────────────────────
  section('1. FATSECRET — nutrientsPer100g field shape');

  const fsTotal = await prisma.fatSecretFoodCache.count();
  const fsWithNutrients = await prisma.fatSecretFoodCache.count({
    where: { nutrientsPer100g: { not: null } },
  });
  console.log(`Total FatSecret rows    : ${fsTotal}`);
  console.log(`With nutrientsPer100g   : ${fsWithNutrients}`);
  console.log(`Null nutrientsPer100g   : ${fsTotal - fsWithNutrients}`);

  const fsSamples = await prisma.fatSecretFoodCache.findMany({
    where: { nutrientsPer100g: { not: null } },
    select: { id: true, name: true, nutrientsPer100g: true },
    take: 5,
  });
  console.log('\nSample nutrientsPer100g shapes:');
  for (const r of fsSamples) {
    console.log(`  ${r.name}:`, JSON.stringify(r.nutrientsPer100g));
  }

  // Check what keys are inside the JSON (calories vs kcal vs energy?)
  const fsAnyNutrient = fsSamples[0]?.nutrientsPer100g as Record<string, unknown> | null;
  if (fsAnyNutrient) {
    console.log('\n  Keys present:', Object.keys(fsAnyNutrient));
  }

  // ── 2. FDC nutrients shape ────────────────────────────────────────────────
  section('2. FDC — nutrients field shape');

  const fdcTotal = await prisma.fdcFoodCache.count();
  const fdcSamples = await prisma.fdcFoodCache.findMany({
    select: { id: true, description: true, nutrients: true },
    take: 5,
  });
  console.log(`Total FDC rows: ${fdcTotal}`);
  console.log('\nSample nutrients shapes:');
  for (const r of fdcSamples) {
    const n = r.nutrients as Record<string, unknown>;
    console.log(`  ${r.description}: keys=${JSON.stringify(Object.keys(n))}`);
    console.log(`    Sample values:`, JSON.stringify(Object.fromEntries(Object.entries(n).slice(0, 5))));
  }

  // ── 3. OFF nutrientsPer100g shape ─────────────────────────────────────────
  section('3. OFF — nutrientsPer100g field shape');

  const offTotal = await prisma.openFoodFactsCache.count();
  const offWithNutrients = await prisma.openFoodFactsCache.count({
    where: { nutrientsPer100g: { not: null } },
  });
  console.log(`Total OFF rows          : ${offTotal}`);
  console.log(`With nutrientsPer100g   : ${offWithNutrients}`);
  console.log(`Null nutrientsPer100g   : ${offTotal - offWithNutrients}`);

  const offSamples = await prisma.openFoodFactsCache.findMany({
    where: { nutrientsPer100g: { not: null } },
    select: { id: true, name: true, nutrientsPer100g: true },
    take: 5,
  });
  console.log('\nSample OFF nutrientsPer100g shapes:');
  for (const r of offSamples) {
    console.log(`  ${r.name}:`, JSON.stringify(r.nutrientsPer100g));
  }

  // ── 4. Cross-check: VMs that have no nutrition — do their cache rows exist?
  section('4. CROSS-CHECK — VMs with null calories: do cache rows exist?');

  // Load no-nutrition VMs from file
  const noNutrPath = 'logs/vm-no-nutrition-2026-04-25.json';
  if (!fs.existsSync(noNutrPath)) {
    console.log('No vm-no-nutrition file found, skipping cross-check');
  } else {
    const noNutrVMs: Array<{ foodId: string; source: string; foodName: string; rawIngredient: string }> =
      JSON.parse(fs.readFileSync(noNutrPath, 'utf8'));

    console.log(`Total no-nutrition VMs in file: ${noNutrVMs.length}`);

    const offNoNutr  = noNutrVMs.filter(v => v.source === 'openfoodfacts');
    const fdcNoNutr  = noNutrVMs.filter(v => v.source === 'fdc');
    const fsNoNutr   = noNutrVMs.filter(v => v.source === 'fatsecret');

    console.log(`  openfoodfacts : ${offNoNutr.length}`);
    console.log(`  fdc           : ${fdcNoNutr.length}`);
    console.log(`  fatsecret     : ${fsNoNutr.length}`);

    // Check: do the OFF cache rows actually have nutrientsPer100g populated?
    if (offNoNutr.length > 0) {
      const sampleOffIds = offNoNutr.slice(0, 100).map(v => v.foodId);
      const offRows = await prisma.openFoodFactsCache.findMany({
        where: { id: { in: sampleOffIds } },
        select: { id: true, name: true, nutrientsPer100g: true },
      });
      const offMissing = offRows.filter(r => !r.nutrientsPer100g);
      const offHasData = offRows.filter(r => {
        const n = r.nutrientsPer100g as Record<string, unknown> | null;
        return n && n.calories != null;
      });
      const offHasWrongKey = offRows.filter(r => {
        const n = r.nutrientsPer100g as Record<string, unknown> | null;
        return n && n.calories == null && Object.keys(n).length > 0;
      });
      console.log(`\n  OFF sample (100): cache row missing entirely: ${offMissing.length}`);
      console.log(`  OFF sample (100): has calories key: ${offHasData.length}`);
      console.log(`  OFF sample (100): has data but NO calories key: ${offHasWrongKey.length}`);
      if (offHasWrongKey.length > 0) {
        const example = offHasWrongKey[0].nutrientsPer100g as Record<string, unknown>;
        console.log(`    Example wrong-key entry keys: ${JSON.stringify(Object.keys(example))}`);
        console.log(`    Values:`, JSON.stringify(Object.fromEntries(Object.entries(example).slice(0, 6))));
      }
    }

    // Check: do the FDC cache rows have calories?
    if (fdcNoNutr.length > 0) {
      const sampleFdcIds = fdcNoNutr.slice(0, 50).map(v => Number(v.foodId)).filter(n => !isNaN(n));
      const fdcRows = await prisma.fdcFoodCache.findMany({
        where: { id: { in: sampleFdcIds } },
        select: { id: true, description: true, nutrients: true },
      });
      const fdcHasCal = fdcRows.filter(r => {
        const n = r.nutrients as Record<string, unknown>;
        return n.calories != null || n.energy != null || n.kcal != null;
      });
      const fdcWrongKey = fdcRows.filter(r => {
        const n = r.nutrients as Record<string, unknown>;
        return n.calories == null;
      });
      console.log(`\n  FDC sample (${fdcRows.length}): has calories/energy/kcal: ${fdcHasCal.length}`);
      console.log(`  FDC sample (${fdcRows.length}): no 'calories' key: ${fdcWrongKey.length}`);
      if (fdcWrongKey.length > 0) {
        const example = fdcWrongKey[0].nutrients as Record<string, unknown>;
        console.log(`    Example FDC keys: ${JSON.stringify(Object.keys(example).slice(0, 10))}`);
      }
    }
  }

  // ── 5. AI-flagged pattern analysis ───────────────────────────────────────
  section('5. AI-FLAGGED — pattern analysis');

  const flaggedPath = 'logs/vm-nutrition-ai-flagged-2026-04-25.json';
  if (!fs.existsSync(flaggedPath)) {
    console.log('No flagged file found');
  } else {
    const flagged: Array<{
      rawIngredient: string; foodName: string; brandName: string | null;
      source: string; nutrition: { caloriesPer100g: number | null; proteinPer100g: number | null; carbsPer100g: number | null; fatPer100g: number | null };
    }> = JSON.parse(fs.readFileSync(flaggedPath, 'utf8'));

    console.log(`Total flagged: ${flagged.length}`);

    // Classify by likely issue
    const highCalOil  = flagged.filter(f => f.nutrition.caloriesPer100g != null && f.nutrition.caloriesPer100g > 800 && (f.nutrition.fatPer100g ?? 0) > 90);
    const zeroCalWith = flagged.filter(f => f.nutrition.caloriesPer100g === 0 && (f.nutrition.carbsPer100g ?? 0) > 50);
    const missingCarbs = flagged.filter(f => f.nutrition.carbsPer100g == null && f.nutrition.caloriesPer100g != null);
    const lowCalForFood = flagged.filter(f => {
      const cal = f.nutrition.caloriesPer100g ?? 0;
      const name = (f.foodName + f.rawIngredient).toLowerCase();
      return cal < 30 && (name.includes('chip') || name.includes('cracker') || name.includes('nut') || name.includes('cookie') || name.includes('oil'));
    });
    const highCalSnack = flagged.filter(f => {
      const cal = f.nutrition.caloriesPer100g ?? 0;
      const name = (f.rawIngredient).toLowerCase();
      return cal > 400 && (name.includes('1 cup') && !name.includes('oil') && !name.includes('seed') && !name.includes('nut'));
    });

    console.log(`\n  Category breakdown:`);
    console.log(`  Oils/fats with >800kcal (correct for oils, flagged in error?): ${highCalOil.length}`);
    console.log(`  Zero-calorie with high carbs (erythritol-type sweeteners):     ${zeroCalWith.length}`);
    console.log(`  Missing carbs key entirely:                                     ${missingCarbs.length}`);
    console.log(`  Low cal for high-energy food type:                              ${lowCalForFood.length}`);
    console.log(`  High cal "1 cup" snack/grain items:                             ${highCalSnack.length}`);

    console.log('\n  Sample high-cal oils (likely false positives):');
    highCalOil.slice(0, 5).forEach(f =>
      console.log(`    [${f.rawIngredient}] -> ${f.foodName} | Cal:${f.nutrition.caloriesPer100g} F:${f.nutrition.fatPer100g}`)
    );

    console.log('\n  Sample zero-cal sweeteners (likely false positives):');
    zeroCalWith.slice(0, 5).forEach(f =>
      console.log(`    [${f.rawIngredient}] -> ${f.foodName} | Cal:${f.nutrition.caloriesPer100g} C:${f.nutrition.carbsPer100g}`)
    );

    console.log('\n  Sample missing-carbs entries (possible data gap):');
    missingCarbs.slice(0, 5).forEach(f =>
      console.log(`    [${f.rawIngredient}] -> ${f.foodName} | Cal:${f.nutrition.caloriesPer100g} P:${f.nutrition.proteinPer100g} C:${f.nutrition.carbsPer100g} F:${f.nutrition.fatPer100g}`)
    );

    // True positives: not oils, not sweeteners, not snacks-in-cups
    const likelyTruePositive = flagged.filter(f => {
      const cal = f.nutrition.caloriesPer100g ?? 0;
      const fat = f.nutrition.fatPer100g ?? 0;
      const name = (f.foodName + ' ' + f.rawIngredient).toLowerCase();
      const isOil = fat > 90 && cal > 800;
      const isSweetener = cal === 0;
      return !isOil && !isSweetener;
    });
    console.log(`\n  Likely true positives (not oils, not zero-cal sweeteners): ${likelyTruePositive.length}`);
    console.log('\n  Sample true positives:');
    likelyTruePositive.slice(0, 15).forEach(f =>
      console.log(`    [${f.source}] "${f.rawIngredient}" -> ${f.foodName} | Cal:${f.nutrition.caloriesPer100g?.toFixed(0)} P:${f.nutrition.proteinPer100g?.toFixed(1)} C:${f.nutrition.carbsPer100g?.toFixed(1)} F:${f.nutrition.fatPer100g?.toFixed(1)}`)
    );
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
