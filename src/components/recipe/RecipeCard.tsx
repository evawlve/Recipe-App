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
  _count?: { likes: number; comments: number };
}

interface RecipeCardProps {
  recipe: RecipeWithRelations;
}

export function RecipeCard({ recipe }: RecipeCardProps) {
  const primaryImageUrl = recipe.photos.length > 0 ? imageSrcForKey(recipe.photos[0].s3Key) : null;
  const nutrition = recipe.nutrition;

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow h-full flex flex-col">
      <Link href={`/recipes/${recipe.id}`} className="flex flex-col h-full">
        <div className="relative w-full h-48 overflow-hidden rounded-lg bg-secondary" aria-hidden style={{ position: 'relative' }}>
          {primaryImageUrl ? (
            <Image
              src={primaryImageUrl}
              alt={recipe.title}
              width={400}
              height={192}
              priority={true}
              className="object-cover w-full h-full"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
            />
          ) : (
            <div className="h-full w-full grid place-items-center text-muted">No image</div>
          )}
        </div>
        
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="line-clamp-2 text-lg">{recipe.title}</CardTitle>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>By {recipe.author.name || "Anonymous"}</span>
            <span>{new Date(recipe.createdAt).toLocaleDateString()}</span>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0 flex-shrink-0">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-3 text-muted-foreground">
              {nutrition && (
                <div className="flex items-center gap-2">
                  <span>{nutrition.calories} cal</span>
                  <span>•</span>
                  <span>{nutrition.proteinG.toFixed(1)}g protein</span>
                </div>
              )}
              {typeof recipe._count?.likes === 'number' && (
                <span>❤ {recipe._count.likes}</span>
              )}
              {typeof recipe._count?.comments === 'number' && (
                <span>💬 {recipe._count.comments}</span>
              )}
            </div>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}
