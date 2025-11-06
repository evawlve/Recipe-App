import { PrismaClient, TagNamespace } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fix tags that were incorrectly assigned to MEAL_TYPE namespace during migration.
 * 
 * The migration 20251024173300 set ALL existing tags to MEAL_TYPE by default,
 * which caused tags like "high_protein" and "testing" to be incorrectly categorized.
 */

const correctNamespaces: Record<string, TagNamespace> = {
  // Diet tags that should NOT be in MEAL_TYPE
  'high_protein': TagNamespace.DIET,
  'high-protein': TagNamespace.DIET,
  'high protein': TagNamespace.DIET,
  'low_carb': TagNamespace.DIET,
  'low carb': TagNamespace.DIET,
  'keto': TagNamespace.DIET,
  'paleo': TagNamespace.DIET,
  'gluten_free': TagNamespace.DIET,
  'gluten free': TagNamespace.DIET,
  'dairy_free': TagNamespace.DIET,
  'dairy free': TagNamespace.DIET,
  'vegan': TagNamespace.DIET,
  'vegetarian': TagNamespace.DIET,
  'nut_free': TagNamespace.DIET,
  'nut free': TagNamespace.DIET,
  
  // Method tags
  'air_fry': TagNamespace.METHOD,
  'air fry': TagNamespace.METHOD,
  'bake': TagNamespace.METHOD,
  'grill': TagNamespace.METHOD,
  'slow_cooker': TagNamespace.METHOD,
  'slow cooker': TagNamespace.METHOD,
  'instant_pot': TagNamespace.METHOD,
  'instant pot': TagNamespace.METHOD,
  
  // Cuisine tags
  'mexican': TagNamespace.CUISINE,
  'italian': TagNamespace.CUISINE,
  'american': TagNamespace.CUISINE,
  'japanese': TagNamespace.CUISINE,
  'chinese': TagNamespace.CUISINE,
  'indian': TagNamespace.CUISINE,
  'thai': TagNamespace.CUISINE,
  'greek': TagNamespace.CUISINE,
  'french': TagNamespace.CUISINE,
  'korean': TagNamespace.CUISINE,
  
  // Goal tags
  'pre_workout': TagNamespace.GOAL,
  'pre workout': TagNamespace.GOAL,
  'post_workout': TagNamespace.GOAL,
  'post workout': TagNamespace.GOAL,
  'weight_loss': TagNamespace.GOAL,
  'weight loss': TagNamespace.GOAL,
  'muscle_gain': TagNamespace.GOAL,
  'muscle gain': TagNamespace.GOAL,
  'maintenance': TagNamespace.GOAL,
};

// Tags that should be deleted (test tags, etc.)
const tagsToDelete = [
  'testing',
  'test',
  'temp',
  'temporary',
];

async function fixTagNamespaces() {
  console.log('🔍 Checking for misclassified tags...\n');
  
  // Find all tags in MEAL_TYPE namespace
  const mealTypeTags = await prisma.tag.findMany({
    where: {
      namespace: TagNamespace.MEAL_TYPE
    },
    include: {
      _count: {
        select: {
          recipes: true
        }
      }
    }
  });
  
  const validMealTypes = ['breakfast', 'lunch', 'dinner', 'dessert', 'snack', 'drinks'];
  const invalidTags = mealTypeTags.filter(tag => 
    !validMealTypes.includes(tag.slug.toLowerCase())
  );
  
  console.log(`Found ${mealTypeTags.length} tags in MEAL_TYPE namespace`);
  console.log(`${invalidTags.length} tags are incorrectly classified:\n`);
  
  if (invalidTags.length === 0) {
    console.log('✅ No misclassified tags found!');
    return;
  }
  
  // Group by action
  const toUpdate: typeof invalidTags = [];
  const toDelete: typeof invalidTags = [];
  const unknown: typeof invalidTags = [];
  
  for (const tag of invalidTags) {
    if (tagsToDelete.includes(tag.slug.toLowerCase())) {
      toDelete.push(tag);
    } else if (correctNamespaces[tag.slug.toLowerCase()]) {
      toUpdate.push(tag);
    } else {
      unknown.push(tag);
    }
  }
  
  // Report findings
  console.log('📊 Classification:');
  console.log(`  - ${toUpdate.length} tags to update`);
  console.log(`  - ${toDelete.length} tags to delete`);
  console.log(`  - ${unknown.length} tags need manual review\n`);
  
  // Show details
  if (toUpdate.length > 0) {
    console.log('🔄 Tags to update:');
    for (const tag of toUpdate) {
      const newNamespace = correctNamespaces[tag.slug.toLowerCase()];
      console.log(`  - "${tag.label}" (${tag.slug}) -> ${newNamespace} (used in ${tag._count.recipes} recipes)`);
    }
    console.log();
  }
  
  if (toDelete.length > 0) {
    console.log('🗑️  Tags to delete:');
    for (const tag of toDelete) {
      console.log(`  - "${tag.label}" (${tag.slug}) (used in ${tag._count.recipes} recipes)`);
    }
    console.log();
  }
  
  if (unknown.length > 0) {
    console.log('❓ Tags needing manual review:');
    for (const tag of unknown) {
      console.log(`  - "${tag.label}" (${tag.slug}) (used in ${tag._count.recipes} recipes)`);
    }
    console.log();
  }
  
  // Execute updates
  let updatedCount = 0;
  for (const tag of toUpdate) {
    const newNamespace = correctNamespaces[tag.slug.toLowerCase()];
    await prisma.tag.update({
      where: { id: tag.id },
      data: { namespace: newNamespace }
    });
    updatedCount++;
    console.log(`✅ Updated "${tag.label}" to ${newNamespace}`);
  }
  
  // Execute deletions
  let deletedCount = 0;
  for (const tag of toDelete) {
    // First, remove all recipe associations
    await prisma.recipeTag.deleteMany({
      where: { tagId: tag.id }
    });
    
    // Then delete the tag
    await prisma.tag.delete({
      where: { id: tag.id }
    });
    deletedCount++;
    console.log(`🗑️  Deleted "${tag.label}"`);
  }
  
  console.log();
  console.log('✅ Fix complete!');
  console.log(`  - Updated: ${updatedCount} tags`);
  console.log(`  - Deleted: ${deletedCount} tags`);
  
  if (unknown.length > 0) {
    console.log();
    console.log('⚠️  Warning: Some tags need manual review.');
    console.log('   These tags are in MEAL_TYPE but don\'t match any known category.');
    console.log('   You may want to update or delete them manually.');
  }
}

async function main() {
  try {
    await fixTagNamespaces();
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();

