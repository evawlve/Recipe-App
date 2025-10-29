import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { imageSrcForKey } from "@/lib/images";
import { PhotoGallery } from "@/components/recipe/PhotoGallery";
import { getCurrentUser } from "@/lib/auth";
import LikeButton from "@/components/recipe/LikeButton";
import Comments from "@/components/recipe/Comments";
import DeleteRecipeButton from "@/components/recipe/DeleteRecipeButton";
import SaveButton from "@/components/recipe/SaveButton";
import { AuthorLink } from "@/components/recipe/AuthorLink";
import { RecipeNutritionDisplay } from "@/components/recipe/RecipeNutritionDisplay";
import { SuggestionCard } from "@/components/SuggestionCard";
import { AlsoViewed } from "./_components/AlsoViewed";

interface RecipePageProps {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    created?: string;
  }>;
}

export default async function RecipePage({ params, searchParams }: RecipePageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const recipe = await prisma.recipe.findUnique({
    where: {
      id: resolvedParams.id,
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
          fiberG: true,
          sugarG: true,
          healthScore: true,
          goal: true,
          computedAt: true,
        },
      },
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          displayName: true,
          avatarKey: true,
        },
      },
      ingredients: {
        select: {
          id: true,
          name: true,
          qty: true,
          unit: true,
        },
      },
    },
  });

  if (!recipe) {
    notFound();
  }

  const current = await getCurrentUser();
  const canDelete = current?.id === recipe.authorId;
  
  // Get saved state for current user if signed in
  let savedByMe = false;
  if (current) {
    try {
      const { ensureSavedCollection } = await import("@/lib/collections");
      const savedCollectionId = await ensureSavedCollection(current.id);
      const savedRecipe = await prisma.collectionRecipe.findUnique({
        where: {
          collectionId_recipeId: {
            collectionId: savedCollectionId,
            recipeId: recipe.id
          }
        }
      });
      savedByMe = Boolean(savedRecipe);
    } catch (error) {
      console.error("Error checking saved state:", error);
    }
  }

  const [likeCount, likedByMe, comments] = await Promise.all([
    prisma.like.count({ where: { recipeId: recipe.id } }),
    current ? prisma.like.findUnique({ where: { userId_recipeId: { userId: current.id, recipeId: recipe.id } } }).then(Boolean) : Promise.resolve(false),
    prisma.comment.findMany({
      where: { recipeId: recipe.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
    }),
  ]);

  // Debug logging
  console.log('Recipe photos:', recipe.photos);
  console.log('Number of photos:', recipe.photos.length);

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="outline" asChild>
            <Link href="/recipes">← Back to Recipes</Link>
          </Button>
          {canDelete && (
            <>
              <Button variant="outline" asChild>
                <Link href={`/recipes/${recipe.id}/edit`}>Edit Recipe</Link>
              </Button>
              <DeleteRecipeButton recipeId={recipe.id} />
            </>
          )}
        </div>
        
        <h1 className="text-4xl font-bold text-text mb-2">{recipe.title}</h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          <AuthorLink 
            author={recipe.author} 
            currentUserId={current?.id}
            size="md"
            showAvatar={true}
          />
          <span>•</span>
          <span>{formatDate(recipe.createdAt)}</span>
          <span>•</span>
          <span>{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
          <span>•</span>
          <LikeButton recipeId={recipe.id} initialCount={likeCount} initiallyLiked={Boolean(likedByMe)} />
          <span>•</span>
          <SaveButton 
            recipeId={recipe.id} 
            initiallySaved={savedByMe} 
            isAuthenticated={Boolean(current)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-8">
          {/* Photos Grid */}
          {recipe.photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Photos</CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGallery photos={recipe.photos} recipeTitle={recipe.title} canDelete={canDelete} />
              </CardContent>
            </Card>
          )}

          {/* Nutrition Breakdown - Mobile/Tablet (shown after photos) */}
          <div className="xl:hidden">
            <RecipeNutritionDisplay 
              recipeId={recipe.id}
              servings={recipe.servings}
              isAuthor={canDelete}
              fallbackNutrition={recipe.nutrition}
            />
          </div>

          {/* Ingredients */}
          {recipe.ingredients.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Ingredients</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recipe.ingredients.map((ingredient) => (
                    <li key={ingredient.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {ingredient.qty} {ingredient.unit}
                      </span>
                      <span className="text-text">{ingredient.name}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Recipe Body */}
          <Card>
            <CardHeader>
              <CardTitle>Instructions</CardTitle>
            </CardHeader>
            <CardContent>
              <div 
                className="prose prose-sm max-w-none text-text"
                dangerouslySetInnerHTML={{ 
                  __html: recipe.bodyMd.replace(/\n/g, '<br>') 
                }} 
              />
            </CardContent>
          </Card>

          {/* Comments Section */}
          <Card id="comments">
            <CardHeader>
              <CardTitle>Comments</CardTitle>
            </CardHeader>
            <CardContent>
              <Comments
                recipeId={recipe.id}
                initial={comments as any}
                canPost={Boolean(current)}
                currentUserId={current?.id ?? null}
                recipeAuthorId={recipe.authorId}
              />
            </CardContent>
          </Card>

          {/* Show suggestion card if recipe was just created */}
          {resolvedSearchParams.created === "1" && (
            <SuggestionCard recipeId={recipe.id} />
          )}
        </div>

        {/* Nutrition Sidebar - Desktop only */}
        <div className="hidden xl:block xl:col-span-1">
          <RecipeNutritionDisplay 
            recipeId={recipe.id}
            servings={recipe.servings}
            isAuthor={canDelete}
            fallbackNutrition={recipe.nutrition}
          />
        </div>
      </div>

      {/* Users also looked at section */}
      <div className="mt-12">
        <AlsoViewed recipeId={recipe.id} />
      </div>
    </div>
  );
}
