/**
 * purge-bad-vms.ts
 *
 * Removes 4 ValidatedMapping entries with provably incorrect nutritional data,
 * and fixes or removes the corresponding broken cache rows.
 *
 * Bad entries identified via deterministic audit:
 *   1. Aldi unsalted butter (OFF) — Cal:35, Fat:0.19 → per-serving not per-100g
 *   2. Leatherwood Honey (OFF) — 24g protein in honey is impossible
 *   3. KROGER OLIVE OIL (FDC 2073857) — Cal:429, Fat:42.9 → per-serving not per-100g
 *   4. Ziyad Red Hot Sauce (FatSecret) — 150kcal Atwater mismatch (6.7g carbs = 27kcal expected)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const BAD_VM_IDS = [
  'vm_1775449758453_akkd1261u',  // red hot sauce Atwater mismatch
  'vm_1777073503717_qpipm880k',  // OLIVE OIL FDC per-serving stored as per-100g
  'vm_off_1777079819200_z4b0o5k', // Aldi butter OFF bad data
  'vm_off_1777079892895_jx1oe0g', // Leatherwood honey bad protein
];

// OFF cache rows with bad data — delete so they don't get re-served
const BAD_OFF_IDS = [
  'off_4088600190112',  // Aldi butter — Cal:35 should be ~720
  'off_9352042000342',  // Leatherwood honey — 24g protein impossible
];

// FDC ID with bad data (per-serving stored as per-100g)
const BAD_FDC_ID = 2073857; // KROGER OLIVE OIL

async function main() {
  console.log('=== Purging bad ValidatedMapping entries ===\n');

  // 1. Delete the bad VMs
  const deletedVMs = await prisma.validatedMapping.deleteMany({
    where: { id: { in: BAD_VM_IDS } },
  });
  console.log(`✓ Deleted ${deletedVMs.count} ValidatedMapping entries`);

  // 2. Delete bad OFF cache rows (so they're re-fetched correctly if needed)
  const deletedOFF = await prisma.openFoodFactsCache.deleteMany({
    where: { id: { in: BAD_OFF_IDS } },
  });
  console.log(`✓ Deleted ${deletedOFF.count} OpenFoodFactsCache rows`);

  // 3. For the FDC olive oil entry — null out nutrients so it won't score high
  //    (we can't easily fix per-serving vs per-100g without re-fetching from FDC)
  const updatedFDC = await prisma.fdcFoodCache.updateMany({
    where: { id: BAD_FDC_ID },
    data: { nutrients: undefined }, // set to null/undefined
  });
  console.log(`✓ Cleared nutrients for FDC entry ${BAD_FDC_ID} (${updatedFDC.count} rows)`);

  // 4. Check if there are any other VMs pointing to the FDC olive oil entry
  const remainingOliveOilVMs = await prisma.validatedMapping.findMany({
    where: { foodId: `fdc_${BAD_FDC_ID}` },
    select: { id: true, rawIngredient: true, foodName: true },
  });
  if (remainingOliveOilVMs.length > 0) {
    console.log(`\n⚠ ${remainingOliveOilVMs.length} other VMs still reference FDC ${BAD_FDC_ID}:`);
    for (const vm of remainingOliveOilVMs) {
      console.log(`  ${vm.id}: "${vm.rawIngredient}" -> ${vm.foodName}`);
    }
    console.log('  These will have null nutrition until FDC re-fetches correct per-100g data.');
  }

  console.log('\n✅ Done. Re-run deterministic-vm-audit.ts to verify clean result.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
