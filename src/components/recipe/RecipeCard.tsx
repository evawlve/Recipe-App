"use client";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Recipe } from "@prisma/client";
import { imageSrcForKey } from "@/lib/images";
import SaveButton from "./SaveButton";
import { AuthorLink } from "./AuthorLink";
import { ThumbsUp, MessageCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { useViewPing } from "@/hooks/useViewPing";
import { HealthScoreMeter } from "./HealthScoreMeter";
import { RecipeCardImage } from "./RecipeCardImage";

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
    healthScore?: number | null;
  } | null;
  savedByMe?: boolean;
  likedByMe?: boolean;
  author: {
    id: string;
    name: string | null;
    username: string | null;
    displayName: string | null;
    avatarKey: string | null;
  };
  _count?: { likes: number; comments: number };
}

interface RecipeCardProps {
  recipe: RecipeWithRelations;
  currentUserId?: string | null;
  isPriority?: boolean;
}

export function RecipeCard({ recipe, currentUserId, isPriority = false }: RecipeCardProps) {
  const primaryImageUrl = recipe.photos.length > 0 ? imageSrcForKey(recipe.photos[0].s3Key) : null;
  const nutrition = recipe.nutrition;
  
  // View tracking
  const viewRef = useViewPing(recipe.id);
  
  // Like functionality
  const [liked, setLiked] = useState(recipe.likedByMe || false);
  const [likeCount, setLikeCount] = useState(recipe._count?.likes || 0);
  const [pending, startTransition] = useTransition();
  const [showAuthPopup, setShowAuthPopup] = useState(false);

  const handleLike = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!currentUserId) {
      setShowAuthPopup(true);
      setTimeout(() => setShowAuthPopup(false), 3000);
      return;
    }

    startTransition(async () => {
      const next = !liked;
      setLiked(next);
      setLikeCount(prev => prev + (next ? 1 : -1));
      
      const res = await fetch(`/api/recipes/${recipe.id}/like`, { 
        method: next ? "POST" : "DELETE" 
      });
      
      if (!res.ok) {
        setLiked(!next);
        setLikeCount(prev => prev + (next ? -1 : 1));
        if (res.status === 401) {
          setShowAuthPopup(true);
          setTimeout(() => setShowAuthPopup(false), 3000);
        }
      } else {
        const data = await res.json();
        setLiked(data.liked);
        setLikeCount(data.count);
      }
    });
  };

  const handleCommentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    window.location.href = `/recipes/${recipe.id}#comments`;
  };

  return (
    <Card ref={viewRef} className="hover:shadow-lg transition-shadow h-full flex flex-col border-0">
      <Link href={`/recipes/${recipe.id}`} className="flex flex-col h-full">
        <div className="relative w-full h-48 md:h-56 overflow-hidden rounded-lg bg-secondary" aria-hidden>
          {primaryImageUrl ? (
            <RecipeCardImage
              src={primaryImageUrl}
              alt={recipe.title}
              isPriority={isPriority}
            />
          ) : (
            <div className="h-full w-full grid place-items-center text-muted">No image</div>
          )}
          
          {/* Health Score Meter - Bottom Right */}
          {nutrition?.healthScore != null && (
            <div className="absolute bottom-2 right-2 bg-background/90 backdrop-blur-sm rounded-lg p-1.5">
              <HealthScoreMeter score={nutrition.healthScore} size="sm" />
            </div>
          )}
        </div>
        
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="line-clamp-2 text-xl md:text-lg font-bold">{recipe.title}</CardTitle>
          
          {/* Author - Desktop */}
          <div className="hidden md:block text-sm text-muted-foreground">
            <AuthorLink 
              author={recipe.author} 
              currentUserId={currentUserId}
              size="sm"
              showAvatar={true}
              useButton={true}
            />
          </div>
          
          {/* Author - Mobile */}
          <div className="md:hidden text-sm text-muted-foreground">
            <AuthorLink 
              author={recipe.author} 
              currentUserId={currentUserId}
              size="md"
              showAvatar={true}
              useButton={true}
            />
          </div>
        </CardHeader>
        
        <CardContent className="pt-0 flex-shrink-0">
          {/* Nutrition section */}
          {nutrition && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2.5">
                <span className="font-semibold text-base">{nutrition.calories} cal</span>
                <span>•</span>
                <span className="font-semibold text-base">{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="font-medium">{nutrition.proteinG.toFixed(0)}g protein</span>
                <span>•</span>
                <span className="font-medium">{nutrition.carbsG.toFixed(0)}g carbs</span>
                <span>•</span>
                <span className="font-medium">{nutrition.fatG.toFixed(0)}g fat</span>
              </div>
            </div>
          )}
        </CardContent>
      </Link>
      
      {/* Bottom section with likes, comments, and save button */}
      <div className="mt-auto px-6 pb-4">
        <div className="flex items-center justify-end">
          <div className="flex items-center gap-4">
            {/* Likes and Comments */}
            <div className="flex items-center gap-3 text-muted-foreground">
              {typeof recipe._count?.likes === 'number' && (
                <button 
                  onClick={handleLike}
                  disabled={pending}
                  className="flex items-center gap-1 hover:text-primary transition-colors disabled:opacity-50 relative"
                >
                  <ThumbsUp className={`h-4 w-4 ${liked ? 'text-green-600 fill-green-600' : ''}`} />
                  <span>{likeCount}</span>
                  
                  {/* Auth popup */}
                  {showAuthPopup && (
                    <div className="absolute top-full right-0 mt-2 z-[100]">
                      <div className="bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
                        Please sign in
                      </div>
                    </div>
                  )}
                </button>
              )}
              {typeof recipe._count?.comments === 'number' && (
                <button 
                  onClick={handleCommentClick}
                  className="flex items-center gap-1 hover:text-primary transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>{recipe._count.comments}</span>
                </button>
              )}
            </div>
            
            {/* Save button */}
            <SaveButton 
              recipeId={recipe.id} 
              initiallySaved={recipe.savedByMe || false} 
              variant="small"
              isAuthenticated={Boolean(currentUserId)}
            />
          </div>
        </div>
      </div>
    </Card>
  );
}
