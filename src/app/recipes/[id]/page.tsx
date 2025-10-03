import { prisma } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { imageSrcForKey } from "@/lib/images";
import { PhotoGallery } from "@/components/recipe/PhotoGallery";

interface RecipePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function RecipePage({ params }: RecipePageProps) {
  const resolvedParams = await params;
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
        },
      },
      author: {
        select: {
          name: true,
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
        </div>
        
        <h1 className="text-4xl font-bold text-text mb-2">{recipe.title}</h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          <span>By {recipe.author.name || "Anonymous"}</span>
          <span>•</span>
          <span>{formatDate(recipe.createdAt)}</span>
          <span>•</span>
          <span>{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Photos Grid */}
          {recipe.photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Photos</CardTitle>
              </CardHeader>
              <CardContent>
                <PhotoGallery photos={recipe.photos} recipeTitle={recipe.title} />
              </CardContent>
            </Card>
          )}

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
        </div>

        {/* Nutrition Sidebar */}
        <div className="lg:col-span-1">
          {recipe.nutrition && (
            <Card className="sticky top-8">
              <CardHeader>
                <CardTitle>Nutrition Facts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-text">
                    {recipe.nutrition.calories}
                  </div>
                  <div className="text-sm text-muted-foreground">calories</div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Protein</span>
                    <span className="text-sm font-medium text-text">
                      {recipe.nutrition.proteinG.toFixed(1)}g
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Carbs</span>
                    <span className="text-sm font-medium text-text">
                      {recipe.nutrition.carbsG.toFixed(1)}g
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Fat</span>
                    <span className="text-sm font-medium text-text">
                      {recipe.nutrition.fatG.toFixed(1)}g
                    </span>
                  </div>
                </div>
                
                <div className="pt-4 border-t border-border">
                  <div className="text-xs text-muted-foreground">
                    Per serving • {recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
