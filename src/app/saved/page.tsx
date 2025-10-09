import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { ensureSavedCollection } from "@/lib/collections";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import Link from "next/link";
import { redirect } from "next/navigation";

export default async function SavedPage() {
  const currentUser = await getCurrentUser();
  
  if (!currentUser) {
    redirect("/signin");
  }

  // Get or create the user's Saved collection
  const savedCollectionId = await ensureSavedCollection(currentUser.id);

  // Fetch saved recipes with relations
  const savedRecipes = await prisma.recipe.findMany({
    where: {
      collections: {
        some: {
          collectionId: savedCollectionId
        }
      }
    },
    include: {
      photos: {
        select: {
          id: true,
          s3Key: true,
          width: true,
          height: true,
        },
      },
      nutrition: {
        select: {
          calories: true,
          proteinG: true,
          carbsG: true,
          fatG: true,
        },
      },
      author: {
        select: {
          name: true,
        },
      },
      _count: {
        select: { likes: true, comments: true },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  // Add saved state to recipes (they're all saved by definition)
  const recipesWithSavedState = savedRecipes.map(recipe => ({
    ...recipe,
    savedByMe: true
  }));

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-3xl font-bold text-text">Saved</h1>
          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
            {savedRecipes.length} recipe{savedRecipes.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-muted-foreground">
          Your collection of saved recipes
        </p>
      </div>

      {savedRecipes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold text-text mb-2">No saved recipes yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Start exploring recipes and save the ones you like!
            </p>
            <Button asChild>
              <Link href="/recipes">Browse Recipes</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recipesWithSavedState.map((recipe) => (
            <RecipeCard 
              key={recipe.id} 
              recipe={recipe} 
              currentUserId={currentUser.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
