import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
const p = new PrismaClient();
async function main() {
  const noNutr: Array<{ foodId: string; source: string; rawIngredient: string; foodName: string }> =
    JSON.parse(fs.readFileSync('logs/vm-no-nutrition-2026-04-25.json', 'utf8'));

  const fdcVMs = noNutr.filter(v => v.source === 'fdc').slice(0, 10);
  console.log('Sample FDC no-nutrition VMs:');
  fdcVMs.forEach(v => console.log('  foodId:', JSON.stringify(v.foodId), ' raw:', v.rawIngredient));

  const ids = fdcVMs.map(v => Number(v.foodId)).filter(n => !isNaN(n));
  console.log('Numeric IDs:', ids);
  if (ids.length > 0) {
    const rows = await p.fdcFoodCache.findMany({ where: { id: { in: ids } }, select: { id: true, description: true, nutrients: true }, take: 5 });
    console.log('Rows found:', rows.length);
    rows.forEach(r => {
      const n = r.nutrients as Record<string, unknown>;
      console.log(' ', r.id, r.description, '| keys:', Object.keys(n));
    });
  }

  // What is the actual source value stored in VMs for fdc?
  const allFdcVMs = await p.validatedMapping.findMany({ where: { source: 'fdc' }, select: { foodId: true, source: true }, take: 5 });
  console.log('FDC VM sample foodIds:', allFdcVMs.map(v => v.foodId));

  // What's in the flagged file - extract garlic powder etc to understand why they are flagged
  const flagged: Array<{ rawIngredient: string; foodName: string; source: string; nutrition: Record<string, unknown> }> =
    JSON.parse(fs.readFileSync('logs/vm-nutrition-ai-flagged-2026-04-25.json', 'utf8'));
  
  // ginger: Cal 100 P:2 C:18 F:1 — is that wrong?
  const ginger = flagged.filter(f => f.rawIngredient.includes('ginger') || f.foodName.toLowerCase().includes('ginger'));
  console.log('\nGinger entries flagged:', ginger.length);
  ginger.slice(0, 5).forEach(f => console.log(' ', f.rawIngredient, '->', f.foodName, JSON.stringify(f.nutrition)));

  // Garlic: Cal 133 P:6 C:33 F:0.7 — garlic per 100g is actually ~149 kcal, so 133 is suspicious but plausible
  const garlic = flagged.filter(f => f.rawIngredient.includes('garlic') || f.foodName.toLowerCase().includes('garlic'));
  console.log('\nGarlic entries flagged:', garlic.length);
  garlic.slice(0, 5).forEach(f => console.log(' ', f.rawIngredient, '->', f.foodName, JSON.stringify(f.nutrition)));

  // Fajita seasoning: Cal 333 C:66.7 — that's a dry spice blend, actually plausible
  // Red table wine: Cal 85 — that's correct per 100g
  // Protein powder: Cal 333 P:60.6 — this looks correct too
  // What's truly wrong here?
  const trulyWrong = flagged.filter(f => {
    const n = f.nutrition;
    const cal = n.caloriesPer100g as number;
    const p2 = (n.proteinPer100g as number) ?? 0;
    const c = (n.carbsPer100g as number) ?? 0;
    const fat = (n.fatPer100g as number) ?? 0;
    const fatG = fat > 90 && cal > 800;
    const zeroC = cal === 0;
    // Macro-sum should be within 30% of stated calories
    const expectedCal = (p2 * 4) + (c * 4) + (fat * 9);
    const bigDiff = Math.abs(cal - expectedCal) > expectedCal * 0.30 + 30;
    return !fatG && !zeroC && cal > 0 && bigDiff;
  });
  console.log('\nEntries with >30% macro-calorie discrepancy:', trulyWrong.length);
  trulyWrong.slice(0, 20).forEach(f => {
    const n = f.nutrition;
    const p2 = (n.proteinPer100g as number) ?? 0;
    const c = (n.carbsPer100g as number) ?? 0;
    const fat = (n.fatPer100g as number) ?? 0;
    const expected = (p2 * 4) + (c * 4) + (fat * 9);
    const cal = n.caloriesPer100g as number;
    console.log(`  "${f.rawIngredient}" -> ${f.foodName} | Stated:${cal.toFixed(0)} Expected:${expected.toFixed(0)} diff:${Math.abs(cal-expected).toFixed(0)}`);
  });
}
main().catch(console.error).finally(() => p.$disconnect());
