'use client';
import * as React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { FollowingEmpty } from './FollowingEmpty';

type Item = {
  id: string;
  title: string;
  createdAt: string | Date;
  photos?: { s3Key: string; width: number; height: number }[];
  author: { id: string; name?: string | null; username?: string | null; displayName?: string | null; avatarKey?: string | null };
  tags: { tag: { slug: string; label: string } }[];
  nutrition?: { calories: number; proteinG: number; carbsG: number; fatG: number } | null;
  _count: { likes: number; comments: number };
};

export function FollowingRail({ 
  currentUserId, 
  initialRecipes = [] 
}: { 
  currentUserId: string | null;
  initialRecipes?: Item[];
}) {
  const [items, setItems] = React.useState<Item[]>(initialRecipes);
  const [loading, setLoading] = React.useState(false);
  const ref = React.useRef<HTMLDivElement|null>(null);

  // Only load if we have no initial recipes (empty state)
  React.useEffect(() => { 
    if (initialRecipes.length === 0) {
      setLoading(true);
      // Load empty state data
      fetch('/api/discover/suggest-creators', { cache: 'no-store' })
        .then(r => r.json())
        .then(() => setLoading(false))
        .catch(() => setLoading(false));
    }
  }, []);

  if (loading && items.length === 0) {
    return (
      <div className="flex gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="min-w-[280px] max-w-[320px] snap-start">
            <div className="rounded-2xl overflow-hidden ring-1 ring-border bg-background animate-pulse">
              <div className="aspect-[16/10] bg-muted" />
              <div className="p-3">
                <div className="h-3 bg-muted rounded mb-2" />
                <div className="h-4 bg-muted rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0 && initialRecipes.length === 0) {
    // empty state (not followed anyone or no recent posts)
    return <FollowingEmpty />;
  }

  const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <div className="relative">
      <button 
        aria-label="Scroll left" 
        onClick={() => scrollBy(-400)} 
        className="hidden md:grid place-items-center absolute left-0 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 shadow ring-1 ring-border z-10"
      >
        <ChevronLeft size={18} />
      </button>
      <div 
        ref={ref} 
        className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 pr-4"
      >
        {items.map((r) => (
          <div key={r.id} className="min-w-[280px] max-w-[320px] snap-start">
                    <RecipeCard
                      recipe={{
                        id: r.id,
                        title: r.title,
                        createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.createdAt.toISOString(),
                        author: r.author,
                        photos: r.photos || [],
                        tags: r.tags,
                        nutrition: r.nutrition,
                        _count: r._count,
                        servings: 1, // Default value
                        bodyMd: '', // Default value
                        updatedAt: typeof r.createdAt === 'string' ? new Date(r.createdAt) : r.createdAt,
                        parentId: null,
                        savedByMe: false,
                        likedByMe: false,
                      } as any}
                      currentUserId={currentUserId}
                    />
          </div>
        ))}
      </div>
      <button 
        aria-label="Scroll right" 
        onClick={() => scrollBy(400)} 
        className="hidden md:grid place-items-center absolute right-0 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 shadow ring-1 ring-border z-10"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
