import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixCommunityIngredients() {
  try {
    console.log('🔍 Finding community ingredients with null createdById...');
    
    const ingredientsWithNullCreator = await prisma.food.findMany({
      where: {
        source: 'community',
        createdById: null
      },
      select: {
        id: true,
        name: true,
        createdById: true
      }
    });

    console.log(`Found ${ingredientsWithNullCreator.length} community ingredients with null createdById`);

    if (ingredientsWithNullCreator.length === 0) {
      console.log('✅ No ingredients need fixing');
      return;
    }

    // For now, we'll set them to a system user or mark them as system-created
    // In a real scenario, you might want to:
    // 1. Ask the user which ingredients they created
    // 2. Set them to a specific user ID
    // 3. Or mark them as "legacy" ingredients

    console.log('⚠️  These ingredients cannot be deleted by users:');
    ingredientsWithNullCreator.forEach(ingredient => {
      console.log(`  - ${ingredient.name} (ID: ${ingredient.id})`);
    });

    console.log('\n💡 To fix this, you can either:');
    console.log('1. Delete these ingredients manually if they are not needed');
    console.log('2. Set them to a specific user ID if you know who created them');
    console.log('3. Leave them as-is (they will be marked as system-created)');

    // Option: Mark them as system-created by setting a special user ID
    // Uncomment the following lines if you want to set them to a system user:
    
    /*
    const systemUserId = 'system-user-id'; // Replace with actual system user ID
    
    await prisma.food.updateMany({
      where: {
        source: 'community',
        createdById: null
      },
      data: {
        createdById: systemUserId
      }
    });

    console.log('✅ Updated community ingredients to system user');
    */

  } catch (error) {
    console.error('❌ Error fixing community ingredients:', error);
  } finally {
    await prisma.$disconnect();
  }
}

fixCommunityIngredients();
