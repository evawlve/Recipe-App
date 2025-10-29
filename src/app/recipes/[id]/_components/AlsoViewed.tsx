'use client';
import * as React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { imageSrcForKey } from '@/lib/images';

interface Recipe {
  id: string;
  title: string;
  photos: Array<{
    id: string;
    s3Key: string;
    width: number;
    height: number;
  }>;
  author: {
    id: string;
    name: string | null;
    username: string | null;
    displayName: string | null;
    avatarKey: string | null;
  };
  nutrition: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null;
  _count: {
    likes: number;
    comments: number;
  };
}

interface AlsoViewedProps {
  recipeId: string;
}

export function AlsoViewed({ recipeId }: AlsoViewedProps) {
  const [items, setItems] = React.useState<Recipe[] | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    setLoading(true);
    fetch(`/api/recipes/${recipeId}/similar`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setItems(d.items || []);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error fetching similar recipes:', error);
        setItems([]);
        setLoading(false);
      });
  }, [recipeId]);

  if (loading) {
    return (
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">Users also looked at</h3>
        <div className="flex gap-4 overflow-x-auto no-scrollbar">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-w-[240px] max-w-[280px] block rounded-2xl overflow-hidden ring-1 ring-border bg-background animate-pulse">
              <div className="aspect-[16/10] bg-muted"></div>
              <div className="p-3">
                <div className="h-4 bg-muted rounded mb-2"></div>
                <div className="h-3 bg-muted rounded w-2/3"></div>
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (!items || items.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Users also looked at</h3>
      <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
        {items.map(recipe => {
          const primaryImageUrl = recipe.photos.length > 0 ? imageSrcForKey(recipe.photos[0].s3Key) : null;
          const nutrition = recipe.nutrition;
          
          return (
            <Link 
              key={recipe.id} 
              href={`/recipes/${recipe.id}`}
              className="min-w-[240px] max-w-[280px] block rounded-2xl overflow-hidden ring-1 ring-border bg-background hover:ring-2 hover:ring-primary/20 transition-all duration-200 hover:shadow-md"
            >
              <div className="aspect-[16/10] bg-muted relative">
                {primaryImageUrl ? (
                  <Image
                    src={primaryImageUrl}
                    alt={recipe.title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 640px) 240px, 280px"
                  />
                ) : (
                  <div className="h-full w-full grid place-items-center text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              <div className="p-3">
                <h4 className="text-sm font-medium line-clamp-2 mb-2">{recipe.title}</h4>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate">
                    {recipe.author.displayName || recipe.author.name || recipe.author.username || 'Unknown'}
                  </span>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {nutrition && (
                      <span>{nutrition.calories} cal</span>
                    )}
                    <span>•</span>
                    <span>{recipe._count.likes} ❤</span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
