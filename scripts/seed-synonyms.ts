#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '@/lib/db';

/**
 * Synonym pairs: [international/regional term, USDA food name pattern]
 * The pattern is used to find matching foods in the database
 */
type SynonymMapping = {
  alias: string; // The synonym/alias to add
  foodNamePattern: string; // Pattern to match against food.name (case-insensitive)
  categoryHint?: string; // Optional category filter for disambiguation
  preferRaw?: boolean; // Prefer raw/prepared variants
};

const SYNONYM_MAPPINGS: SynonymMapping[] = [
  // Bell Peppers / Capsicum
  { alias: 'capsicum', foodNamePattern: 'pepper.*sweet.*red.*raw', preferRaw: true },
  { alias: 'capsicum', foodNamePattern: 'pepper.*sweet.*green.*raw', preferRaw: true },
  { alias: 'capsicum', foodNamePattern: 'pepper.*sweet.*yellow.*raw', preferRaw: true },
  { alias: 'sweet pepper', foodNamePattern: 'pepper.*sweet.*raw', preferRaw: true },
  
  // Cilantro / Coriander
  { alias: 'coriander', foodNamePattern: 'cilantro.*raw', preferRaw: true },
  { alias: 'coriander leaves', foodNamePattern: 'cilantro.*raw', preferRaw: true },
  { alias: 'chinese parsley', foodNamePattern: 'cilantro.*raw', preferRaw: true },
  
  // Scallions / Green Onions
  { alias: 'green onion', foodNamePattern: 'scallion.*raw', preferRaw: true },
  { alias: 'spring onion', foodNamePattern: 'scallion.*raw', preferRaw: true },
  { alias: 'green onion', foodNamePattern: 'onion.*spring.*raw', preferRaw: true },
  
  // Chickpeas / Garbanzo
  { alias: 'garbanzo bean', foodNamePattern: 'chickpea.*raw', preferRaw: true },
  { alias: 'garbanzo', foodNamePattern: 'chickpea.*raw', preferRaw: true },
  { alias: 'garbanzo bean', foodNamePattern: 'chickpeas.*raw', preferRaw: true },
  
  // Zucchini / Courgette
  { alias: 'courgette', foodNamePattern: 'zucchini.*raw', preferRaw: true },
  { alias: 'courgette', foodNamePattern: 'squash.*summer.*raw', preferRaw: true },
  
  // Eggplant / Aubergine
  { alias: 'aubergine', foodNamePattern: 'eggplant.*raw', preferRaw: true },
  
  // Shrimp / Prawn
  { alias: 'prawn', foodNamePattern: 'shrimp.*raw', preferRaw: true },
  { alias: 'prawns', foodNamePattern: 'shrimp.*raw', preferRaw: true },
  
  // Ground Beef / Beef Mince
  { alias: 'beef mince', foodNamePattern: 'beef.*ground.*raw', preferRaw: true },
  { alias: 'minced beef', foodNamePattern: 'beef.*ground.*raw', preferRaw: true },
  { alias: 'ground beef', foodNamePattern: 'beef.*ground.*raw', preferRaw: true },
  
  // Additional common synonyms
  { alias: 'rocket', foodNamePattern: 'arugula.*raw', preferRaw: true },
  { alias: 'rocket', foodNamePattern: 'salad.*arugula.*raw', preferRaw: true },
  
  { alias: 'coriander seed', foodNamePattern: 'coriander.*seed', preferRaw: true },
  
  { alias: 'snow pea', foodNamePattern: 'pea.*snow.*raw', preferRaw: true },
  { alias: 'mangetout', foodNamePattern: 'pea.*snow.*raw', preferRaw: true },
  
  { alias: 'rutabaga', foodNamePattern: 'swede.*raw', preferRaw: true },
  { alias: 'swede', foodNamePattern: 'rutabaga.*raw', preferRaw: true },
  
  { alias: 'beetroot', foodNamePattern: 'beet.*raw', preferRaw: true },
  
  { alias: 'cornflour', foodNamePattern: 'corn.*starch', preferRaw: true },
  { alias: 'cornstarch', foodNamePattern: 'corn.*flour', preferRaw: true },
  
  { alias: 'icing sugar', foodNamePattern: 'sugar.*powdered', preferRaw: true },
  { alias: 'powdered sugar', foodNamePattern: 'sugar.*icing', preferRaw: true },
  
  { alias: 'caster sugar', foodNamePattern: 'sugar.*granulated', preferRaw: true },
  { alias: 'superfine sugar', foodNamePattern: 'sugar.*granulated', preferRaw: true },
  
  { alias: 'plain flour', foodNamePattern: 'flour.*all.*purpose', preferRaw: true },
  { alias: 'all purpose flour', foodNamePattern: 'flour.*plain', preferRaw: true },
  
  { alias: 'single cream', foodNamePattern: 'cream.*light', preferRaw: true },
  { alias: 'double cream', foodNamePattern: 'cream.*heavy', preferRaw: true },
  { alias: 'heavy cream', foodNamePattern: 'cream.*double', preferRaw: true },
  
  { alias: 'mincemeat', foodNamePattern: 'ground.*meat', preferRaw: true },
  
  { alias: 'pork mince', foodNamePattern: 'pork.*ground.*raw', preferRaw: true },
  { alias: 'minced pork', foodNamePattern: 'pork.*ground.*raw', preferRaw: true },
  
  { alias: 'lamb mince', foodNamePattern: 'lamb.*ground.*raw', preferRaw: true },
  { alias: 'minced lamb', foodNamePattern: 'lamb.*ground.*raw', preferRaw: true },
  
  { alias: 'chicken mince', foodNamePattern: 'chicken.*ground.*raw', preferRaw: true },
  { alias: 'minced chicken', foodNamePattern: 'chicken.*ground.*raw', preferRaw: true },
  
  { alias: 'aubergine', foodNamePattern: 'eggplant.*raw', preferRaw: true },
  
  { alias: 'courgette', foodNamePattern: 'zucchini.*raw', preferRaw: true },
  
  { alias: 'rocket', foodNamePattern: 'arugula.*raw', preferRaw: true },
  
  { alias: 'mangetout', foodNamePattern: 'snow.*pea.*raw', preferRaw: true },
  
  { alias: 'beetroot', foodNamePattern: 'beet.*raw', preferRaw: true },
  
  { alias: 'swede', foodNamePattern: 'rutabaga.*raw', preferRaw: true },
  
  { alias: 'cornflour', foodNamePattern: 'corn.*starch', preferRaw: true },
  
  { alias: 'icing sugar', foodNamePattern: 'sugar.*powdered', preferRaw: true },
  
  { alias: 'caster sugar', foodNamePattern: 'sugar.*granulated', preferRaw: true },
  
  { alias: 'plain flour', foodNamePattern: 'flour.*all.*purpose', preferRaw: true },
  
  { alias: 'single cream', foodNamePattern: 'cream.*light', preferRaw: true },
  { alias: 'double cream', foodNamePattern: 'cream.*heavy', preferRaw: true },
];

function canonicalize(s: string): string {
  return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[,.-]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Find foods matching the pattern, preferring raw variants
 */
async function findMatchingFoods(
  pattern: string,
  categoryHint?: string,
  preferRaw: boolean = true
): Promise<Array<{ id: string; name: string }>> {
  // Convert pattern to Prisma query (simple contains for now)
  // Remove regex patterns and use contains
  const searchTerms = pattern
    .replace(/\.\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const whereConditions = searchTerms.map(term => ({
    name: { contains: term, mode: 'insensitive' as const }
  }));

  const where: any = {
    AND: whereConditions
  };

  if (categoryHint) {
    where.categoryId = categoryHint;
  }

  // Prefer raw foods
  if (preferRaw) {
    where.OR = [
      { name: { contains: 'raw', mode: 'insensitive' } },
      { name: { contains: 'fresh', mode: 'insensitive' } },
      { name: { contains: 'whole', mode: 'insensitive' } }
    ];
  }

  const foods = await prisma.food.findMany({
    where,
    select: {
      id: true,
      name: true,
      categoryId: true
    },
    take: 10 // Limit to avoid too many matches
  });

  // Sort: prefer raw, then by name length (shorter = more canonical)
  return foods.sort((a, b) => {
    const aRaw = a.name.toLowerCase().includes('raw');
    const bRaw = b.name.toLowerCase().includes('raw');
    if (aRaw !== bRaw) return aRaw ? -1 : 1;
    return a.name.length - b.name.length;
  });
}

async function seedSynonyms(dryRun: boolean = false) {
  console.log('🌍 Synonym Seeding Script');
  console.log(`📊 Processing ${SYNONYM_MAPPINGS.length} synonym mappings`);
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No data will be imported');
  }
  console.log('');

  let totalAliases = 0;
  let createdAliases = 0;
  let skippedAliases = 0;
  let foodsNotFound = 0;

  for (const mapping of SYNONYM_MAPPINGS) {
    const canonicalAlias = canonicalize(mapping.alias);
    if (!canonicalAlias) {
      skippedAliases++;
      continue;
    }

    // Find matching foods
    const matchingFoods = await findMatchingFoods(
      mapping.foodNamePattern,
      mapping.categoryHint,
      mapping.preferRaw ?? true
    );

    if (matchingFoods.length === 0) {
      foodsNotFound++;
      console.log(`⚠️  No foods found for pattern: "${mapping.foodNamePattern}" → alias: "${canonicalAlias}"`);
      continue;
    }

    // Use the first (best) match
    const targetFood = matchingFoods[0];
    totalAliases++;

    // Check if alias already exists
    const existing = await prisma.foodAlias.findFirst({
      where: {
        foodId: targetFood.id,
        alias: canonicalAlias
      }
    });

    if (existing) {
      skippedAliases++;
      continue;
    }

    if (!dryRun) {
      try {
        await prisma.foodAlias.create({
          data: {
            foodId: targetFood.id,
            alias: canonicalAlias
          }
        });
        createdAliases++;
        console.log(`✅ "${canonicalAlias}" → "${targetFood.name}"`);
      } catch (error: any) {
        if (error.code === 'P2002') {
          // Unique constraint violation (foodId + alias)
          skippedAliases++;
        } else {
          console.error(`❌ Error creating alias "${canonicalAlias}" for "${targetFood.name}":`, error.message);
        }
      }
    } else {
      createdAliases++;
      console.log(`[DRY RUN] Would create: "${canonicalAlias}" → "${targetFood.name}"`);
    }
  }

  console.log('');
  console.log('📈 Summary:');
  console.log(`  ✅ Created: ${createdAliases}`);
  console.log(`  ⏭️  Skipped (already exists): ${skippedAliases}`);
  console.log(`  ⚠️  Foods not found: ${foodsNotFound}`);
  console.log(`  📊 Total processed: ${totalAliases}`);

  if (dryRun) {
    console.log('');
    console.log('🔍 This was a dry run. Use without --dry-run to actually import.');
  } else {
    console.log('');
    console.log('🎉 Synonym seeding completed successfully!');
  }

  return {
    created: createdAliases,
    skipped: skippedAliases,
    notFound: foodsNotFound,
    total: totalAliases
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  try {
    await seedSynonyms(dryRun);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

