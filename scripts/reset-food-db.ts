/**
 * Reset Food Database Tables
 * 
 * ⚠️  WARNING: This script truncates all legacy food tables.
 * 
 * This script should ONLY be run AFTER:
 * 1. The FatSecret cache schema is in place and migrated
 * 2. The cache is verified to be working correctly
 * 3. Application has been switched to use the cache
 * 
 * Tables that will be truncated:
 * - Food
 * - FoodUnit
 * - FoodAlias
 * - Barcode
 * - PortionOverride
 * - UserPortionOverride
 * - IngredientFoodMap (food mappings only)
 * 
 * Tables that will NOT be affected:
 * - User (and related tables)
 * - Recipe (and related tables)
 * - Ingredient (data preserved, only Food mapping links removed)
 */

import { prisma } from '../src/lib/db';

async function checkCacheTables() {
  // Check if FatSecret cache tables exist
  try {
    const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('FatSecretFoodCache', 'FatSecretServingCache')
    `;

    const tables = new Set(result.map((row) => row.table_name));
    if (!tables.has('FatSecretFoodCache') || !tables.has('FatSecretServingCache')) {
      console.error('❌ FatSecret cache tables not found!');
      console.error('   This script can only run after the cache schema is migrated.');
      console.error('   Run prisma migrate with the Phase 1 migration, then try again.');
      return false;
    }

    console.log('✅ FatSecret cache tables found');
    return true;
  } catch (error) {
    console.error('❌ Error checking for cache tables:', error);
    return false;
  }
}

async function getTableCounts() {
  const counts = {
    Food: 0,
    FoodUnit: 0,
    FoodAlias: 0,
    Barcode: 0,
    PortionOverride: 0,
    UserPortionOverride: 0,
    IngredientFoodMap: 0,
  };

  try {
    counts.Food = await prisma.food.count();
    counts.FoodUnit = await prisma.foodUnit.count();
    counts.FoodAlias = await prisma.foodAlias.count();
    counts.Barcode = await prisma.barcode.count();
    counts.PortionOverride = await prisma.portionOverride.count();
    counts.UserPortionOverride = await prisma.userPortionOverride.count();
    counts.IngredientFoodMap = await prisma.ingredientFoodMap.count();
  } catch (error) {
    console.error('❌ Error getting table counts:', error);
    throw error;
  }

  return counts;
}

async function resetFoodTables() {
  console.log('🔄 Starting food table reset...\n');

  // Step 1: Check for cache tables
  console.log('📋 Step 1: Checking for FatSecret cache tables...');
  const cacheExists = await checkCacheTables();
  if (!cacheExists) {
    process.exit(1);
  }
  console.log();

  // Step 2: Get current counts
  console.log('📊 Step 2: Getting current table counts...');
  const beforeCounts = await getTableCounts();
  console.log('Current counts:');
  Object.entries(beforeCounts).forEach(([table, count]) => {
    console.log(`  ${table.padEnd(25)} ${count.toLocaleString()} rows`);
  });
  console.log();

  // Step 3: Confirm deletion
  console.log('⚠️  WARNING: This will permanently delete all data in the following tables:');
  console.log('   - Food');
  console.log('   - FoodUnit');
  console.log('   - FoodAlias');
  console.log('   - Barcode');
  console.log('   - PortionOverride');
  console.log('   - UserPortionOverride');
  console.log('   - IngredientFoodMap (food mappings only)');
  console.log();

  if (!process.argv.includes('--confirm')) {
    console.log('❌ Safety check: --confirm flag not provided');
    console.log('   To proceed, run: npm run reset:food-db -- --confirm');
    console.log('   Or: tsx scripts/reset-food-db.ts --confirm');
    process.exit(1);
  }

  console.log('✅ Confirmation flag provided, proceeding...\n');

  // Step 4: Truncate tables in correct order (respecting foreign keys)
  console.log('🗑️  Step 3: Truncating tables...');
  
  try {
    await prisma.$transaction(async (tx) => {
      // Delete in order to respect foreign key constraints
      // Start with dependent tables
      console.log('  - Deleting IngredientFoodMap records...');
      await tx.ingredientFoodMap.deleteMany({});
      
      console.log('  - Deleting UserPortionOverride records...');
      await tx.userPortionOverride.deleteMany({});
      
      console.log('  - Deleting PortionOverride records...');
      await tx.portionOverride.deleteMany({});
      
      console.log('  - Deleting FoodAlias records...');
      await tx.foodAlias.deleteMany({});
      
      console.log('  - Deleting Barcode records...');
      await tx.barcode.deleteMany({});
      
      console.log('  - Deleting FoodUnit records...');
      await tx.foodUnit.deleteMany({});
      
      console.log('  - Deleting Food records...');
      await tx.food.deleteMany({});
    });

    console.log('✅ All tables truncated successfully\n');

    // Step 5: Verify deletion
    console.log('🔍 Step 4: Verifying deletion...');
    const afterCounts = await getTableCounts();
    console.log('Final counts:');
    Object.entries(afterCounts).forEach(([table, count]) => {
      const before = beforeCounts[table as keyof typeof beforeCounts];
      console.log(`  ${table.padEnd(25)} ${count.toLocaleString()} rows (was ${before.toLocaleString()})`);
    });

    const allZero = Object.values(afterCounts).every(count => count === 0);
    if (allZero) {
      console.log('\n🎉 Successfully reset all food tables!');
    } else {
      console.error('\n⚠️  Warning: Some tables still have data');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n❌ Error during reset:', error);
    throw error;
  }
}

async function main() {
  try {
    await resetFoodTables();
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


