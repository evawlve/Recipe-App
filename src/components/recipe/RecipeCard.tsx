"use client";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Recipe } from "@prisma/client";
import { imageSrcForKey } from "@/lib/images";
import SaveButton from "./SaveButton";
import { AuthorLink } from "./AuthorLink";
import { ThumbsUp, MessageCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { useViewPing } from "@/hooks/useViewPing";

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
}

export function RecipeCard({ recipe, currentUserId }: RecipeCardProps) {
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
        <div className="relative w-full h-56 overflow-hidden rounded-lg bg-secondary" aria-hidden style={{ position: 'relative' }}>
          {primaryImageUrl ? (
            <Image
              src={primaryImageUrl}
              alt={recipe.title}
              width={600}
              height={224}
              priority={true}
              className="object-cover w-full h-full"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 50vw"
            />
          ) : (
            <div className="h-full w-full grid place-items-center text-muted">No image</div>
          )}
        </div>
        
        <CardHeader className="pb-2 flex-shrink-0">
          <CardTitle className="line-clamp-2 text-lg">{recipe.title}</CardTitle>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <AuthorLink 
              author={recipe.author} 
              currentUserId={currentUserId}
              size="sm"
              showAvatar={true}
              useButton={true}
            />
            <span>{new Date(recipe.createdAt).toLocaleDateString()}</span>
          </div>
        </CardHeader>
        
        <CardContent className="pt-0 flex-shrink-0">
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
      
      {/* Bottom section with likes, comments, and save button */}
      <div className="mt-auto px-6 pb-4">
        <div className="flex items-center justify-between">
          <div></div> {/* Empty div for spacing */}
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
