import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Recipe } from "@prisma/client";
import { imageSrcForKey } from "@/lib/images";

interface RecipeWithRelations extends Recipe {
  photos: Array<{
    id: string;
    s3Key: string;
    width: number;
    height: number;
  }>;
  nutrition: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null;
  author: {
    name: string | null;
  };
}

interface RecipeCardProps {
  recipe: RecipeWithRelations;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const primaryImageUrl = recipe.photos.length > 0 ? imageSrcForKey(recipe.photos[0].s3Key) : null;
  const nutrition = recipe.nutrition;

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow">
      <Link href={`/recipes/${recipe.id}`}>
        <div className="relative">
          {primaryImageUrl ? (
            <div className="relative h-48 w-full">
              <Image
                src={primaryImageUrl}
                alt={recipe.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            </div>
          ) : (
            <div className="h-48 w-full bg-muted flex items-center justify-center">
              <span className="text-muted-foreground">No image</span>
            </div>
          )}
        </div>
        
        <CardHeader className="pb-2">
          <CardTitle className="line-clamp-2 text-lg">{recipe.title}</CardTitle>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>By {recipe.author.name || "Anonymous"}</span>
            <span>{new Date(recipe.createdAt).toLocaleDateString()}</span>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
            {nutrition && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span>{nutrition.calories} cal</span>
                <span>•</span>
                <span>{nutrition.proteinG.toFixed(1)}g protein</span>
              </div>
            )}
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
