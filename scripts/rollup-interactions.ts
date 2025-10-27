import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function rollupInteractions() {
  console.log('Starting interaction rollup...');
  
  // Get yesterday's date in UTC
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  
  console.log(`Rolling up interactions for ${yesterday.toISOString().split('T')[0]}`);
  
  try {
    // Get all recipes that had views yesterday
    const recipesWithViews = await prisma.recipeView.groupBy({
      by: ['recipeId'],
      where: {
        createdAt: {
          gte: yesterday,
          lt: today
        }
      }
    });
    
    console.log(`Found ${recipesWithViews.length} recipes with views yesterday`);
    
    for (const { recipeId } of recipesWithViews) {
      // Count views for this recipe yesterday
      const viewCount = await prisma.recipeView.count({
        where: {
          recipeId,
          createdAt: {
            gte: yesterday,
            lt: today
          }
        }
      });
      
      // Count likes for this recipe yesterday
      const likeCount = await prisma.like.count({
        where: {
          recipeId,
          createdAt: {
            gte: yesterday,
            lt: today
          }
        }
      });
      
      // Count comments for this recipe yesterday
      const commentCount = await prisma.comment.count({
        where: {
          recipeId,
          createdAt: {
            gte: yesterday,
            lt: today
          }
        }
      });
      
      // Count saves for this recipe yesterday (from CollectionRecipe)
      const saveCount = await prisma.collectionRecipe.count({
        where: {
          recipeId,
          addedAt: {
            gte: yesterday,
            lt: today
          }
        }
      });
      
      // Compute interaction score: 0.2*views + 1.0*likes + 2.0*comments + 0.6*saves
      const score = (0.2 * viewCount) + (1.0 * likeCount) + (2.0 * commentCount) + (0.6 * saveCount);
      
      // Upsert the daily interaction record
      await prisma.recipeInteractionDaily.upsert({
        where: {
          recipeId_day: {
            recipeId,
            day: yesterday
          }
        },
        update: {
          views: viewCount,
          likes: likeCount,
          comments: commentCount,
          saves: saveCount,
          score
        },
        create: {
          recipeId,
          day: yesterday,
          views: viewCount,
          likes: likeCount,
          comments: commentCount,
          saves: saveCount,
          score
        }
      });
      
      console.log(`Processed recipe ${recipeId}: ${viewCount} views, ${likeCount} likes, ${commentCount} comments, ${saveCount} saves, score: ${score.toFixed(2)}`);
    }
    
    console.log('Interaction rollup completed successfully');
  } catch (error) {
    console.error('Error during interaction rollup:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the rollup
rollupInteractions()
  .then(() => {
    console.log('Rollup script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Rollup script failed:', error);
    process.exit(1);
  });
