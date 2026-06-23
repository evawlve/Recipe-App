#!/usr/bin/env ts-node

import { prisma } from '@/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const recipeId = args[0];
  
  if (!recipeId) {
    console.error('Usage: ts-node scripts/show-unmapped-ingredients.ts <recipeId>');
    process.exit(1);
  }

  const rows = await prisma.ingredient.findMany({
    where: { recipeId },
    include: { foodMaps: true },
  });

  const unmapped = rows.filter(r => r.foodMaps.length === 0);

  if (unmapped.length === 0) {
    console.log('✅ All ingredients are mapped!');
    await prisma.$disconnect();
    return;
  }

  const data = unmapped.map(r => ({
    ingredientId: r.id,
    line: `${r.qty} ${r.unit || ''} ${r.name}`.trim(),
  }));

  console.log(`\n❌ ${unmapped.length} unmapped ingredient(s):\n`);

  // Try console.table first, fallback to JSON if it doesn't work
  try {
    console.table(data);
  } catch (err) {
    console.log(JSON.stringify(data, null, 2));
  }

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}




