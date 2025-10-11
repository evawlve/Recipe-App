const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');

const prisma = new PrismaClient();
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function cleanupOrphanedUsers() {
  try {
    console.log('🔍 Checking for orphaned users...');
    
    // Get all users from database
    const dbUsers = await prisma.user.findMany({
      select: { id: true, email: true, username: true }
    });
    
    console.log(`📊 Found ${dbUsers.length} users in database`);
    
    // Get all users from Supabase Auth
    const { data: authUsers, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error('❌ Error fetching auth users:', error);
      return;
    }
    
    const authUserIds = new Set(authUsers.users.map(u => u.id));
    console.log(`🔐 Found ${authUserIds.size} users in Supabase Auth`);
    
    // Find orphaned users (exist in DB but not in Auth)
    const orphanedUsers = dbUsers.filter(dbUser => !authUserIds.has(dbUser.id));
    
    console.log(`🧹 Found ${orphanedUsers.length} orphaned users:`);
    orphanedUsers.forEach(user => {
      console.log(`  - ${user.email} (@${user.username})`);
    });
    
    if (orphanedUsers.length === 0) {
      console.log('✅ No orphaned users found!');
      return;
    }
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will permanently delete all data for these users!');
    console.log('This includes: recipes, comments, likes, collections, follows, etc.');
    console.log('\nTo proceed, run: node cleanup-orphaned-users.js --confirm');
    
    if (process.argv.includes('--confirm')) {
      console.log('\n🗑️  Deleting orphaned users...');
      
      for (const user of orphanedUsers) {
        console.log(`Deleting user: ${user.email} (@${user.username})`);
        
        // Delete all user data in a transaction
        await prisma.$transaction(async (tx) => {
          // Get user's data for cleanup
          const userData = await tx.user.findUnique({
            where: { id: user.id },
            include: {
              recipes: {
                include: {
                  photos: true,
                  ingredients: true,
                  nutrition: true,
                  tags: true,
                  comments: true,
                  likes: true,
                  collections: true,
                }
              },
              collections: true,
              comments: true,
              likes: true,
              followedBy: true,
              following: true,
            }
          });

          if (userData) {
            // Delete all user's recipes and related data
            for (const recipe of userData.recipes) {
              await tx.ingredient.deleteMany({ where: { recipeId: recipe.id } });
              await tx.nutrition.deleteMany({ where: { recipeId: recipe.id } });
              await tx.photo.deleteMany({ where: { recipeId: recipe.id } });
              await tx.recipeTag.deleteMany({ where: { recipeId: recipe.id } });
              await tx.collectionRecipe.deleteMany({ where: { recipeId: recipe.id } });
              await tx.comment.deleteMany({ where: { recipeId: recipe.id } });
              await tx.like.deleteMany({ where: { recipeId: recipe.id } });
            }

            // Delete user's recipes
            await tx.recipe.deleteMany({ where: { authorId: user.id } });

            // Delete user's collections
            await tx.collectionRecipe.deleteMany({ 
              where: { collection: { userId: user.id } } 
            });
            await tx.collection.deleteMany({ where: { userId: user.id } });

            // Delete user's comments
            await tx.comment.deleteMany({ where: { userId: user.id } });

            // Delete user's likes
            await tx.like.deleteMany({ where: { userId: user.id } });

            // Delete follow relationships
            await tx.follow.deleteMany({ where: { followerId: user.id } });
            await tx.follow.deleteMany({ where: { followingId: user.id } });

            // Finally, delete the user record
            await tx.user.delete({ where: { id: user.id } });
          }
        });
        
        console.log(`✅ Deleted user: ${user.email}`);
      }
      
      console.log(`\n🎉 Successfully cleaned up ${orphanedUsers.length} orphaned users!`);
    }
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanupOrphanedUsers();
