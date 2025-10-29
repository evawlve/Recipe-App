import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createClient } from "@supabase/supabase-js";

export async function DELETE() {
  try {
    // Skip execution during build time
    if (process.env.NEXT_PHASE === 'phase-production-build' || 
        process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
        process.env.BUILD_TIME === 'true') {
      return NextResponse.json({ error: "Not available during build" }, { status: 503 });
    }

    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.log(`Starting complete user deletion for: ${user.email}`);

    // Get user's data for cleanup
    const userData = await prisma.user.findUnique({
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

    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    console.log(`User has ${userData.recipes.length} recipes, ${userData.collections.length} collections, ${userData.comments.length} comments, ${userData.likes.length} likes`);

    // Start transaction to delete all user data
    await prisma.$transaction(async (tx) => {
      // Delete all user's recipes and related data
      for (const recipe of userData.recipes) {
        // Delete recipe photos from S3 (if needed)
        // Note: You might want to add S3 cleanup here
        
        // Delete recipe-related data
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
    });

    console.log(`Successfully deleted user: ${user.email}`);

    // Delete from Supabase Auth using admin client
    try {
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        }
      );
      
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
      
      if (authError) {
        console.error('Error deleting from Supabase Auth:', authError);
        // Don't fail the request if auth deletion fails - database is already cleaned up
      } else {
        console.log('Successfully deleted from Supabase Auth');
      }
    } catch (authError) {
      console.error('Error with Supabase Auth deletion:', authError);
      // Don't fail the request if auth deletion fails
    }

    return NextResponse.json({ 
      success: true, 
      message: "Account and all associated data deleted successfully",
      redirectTo: "/?message=" + encodeURIComponent("Your account has been deleted successfully.")
    });

  } catch (error) {
    console.error("Error deleting user account:", error);
    return NextResponse.json({ 
      error: "Failed to delete account. Please try again." 
    }, { status: 500 });
  }
}
