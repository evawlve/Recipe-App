'use client';
import * as React from 'react';
import { RecipeCard } from '@/components/recipe/RecipeCard';

type RecipeItem = { 
  id: string; 
  title: string;
  authorId: string;
  bodyMd: string;
  servings: number;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
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
  _count?: {
    likes: number;
    comments: number;
  };
  nutrition: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
  } | null;
  savedByMe?: boolean;
  likedByMe?: boolean;
};

async function fetchFeed(kind: 'foryou'|'following', cursor?: string) {
  try {
    const qs = new URLSearchParams();
    if (cursor) qs.set('cursor', cursor);
    qs.set('limit', '12');
    const res = await fetch(`/api/feed/${kind}?${qs.toString()}`, { cache: 'no-store' });
    
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    
    const data = await res.json();
    return data as { items: RecipeItem[]; nextCursor: string|null };
  } catch (error) {
    console.error(`Error fetching ${kind} feed:`, error);
    return { items: [], nextCursor: null };
  }
}

function Grid({ items, currentUserId }: { items: RecipeItem[]; currentUserId: string | null }) {
  return (
    <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(recipe => (
        <RecipeCard
          key={recipe.id}
          recipe={recipe}
          currentUserId={currentUserId}
        />
      ))}
    </div>
  );
}

export function FeedTabs({ signedIn, currentUserId }: { signedIn: boolean; currentUserId?: string | null }) {
  const [tab, setTab] = React.useState<'foryou'|'following'>(signedIn ? 'foryou' : 'foryou');
  const [state, setState] = React.useState({
    foryou: { items: [] as RecipeItem[], cursor: null as string|null, done: false, init: false },
    following:{ items: [] as RecipeItem[], cursor: null as string|null, done: false, init: false },
  });
  const sentinel = React.useRef<HTMLDivElement|null>(null);
  const loadingRef = React.useRef<Set<string>>(new Set());

  const load = React.useCallback(async (kind: 'foryou'|'following') => {
    // Prevent multiple simultaneous loads of the same kind
    if (loadingRef.current.has(kind)) return;
    
    setState(prev => {
      const s = prev[kind];
      if (s.done) return prev;
      return prev;
    });
    
    const currentState = state[kind];
    if (currentState.done) return;
    
    loadingRef.current.add(kind);
    
    try {
      const response = await fetchFeed(kind, currentState.cursor ?? undefined);
      const { items = [], nextCursor } = response || {};
      
      // Ensure items is always an array
      const safeItems = Array.isArray(items) ? items : [];
      
      setState(prev => {
        // Get existing item IDs to prevent duplicates
        const existingIds = new Set(prev[kind].items.map(item => item.id));
        
        // Filter out items that already exist
        const newItems = safeItems.filter(item => !existingIds.has(item.id));
        
        return {
          ...prev,
          [kind]: {
            items: [...prev[kind].items, ...newItems],
            cursor: nextCursor,
            done: !nextCursor || safeItems.length === 0,
            init: true,
          }
        };
      });
    } catch (error) {
      console.error(`Error loading ${kind} feed:`, error);
      setState(prev => ({
        ...prev,
        [kind]: {
          ...prev[kind],
          done: true,
          init: true,
        }
      }));
    } finally {
      loadingRef.current.delete(kind);
    }
  }, [state]);

  React.useEffect(() => {
    const active = tab;
    if (!state[active].init) load(active);
  }, [tab, load, state]);

  React.useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) load(tab);
    }, { rootMargin: '800px' });
    if (sentinel.current) io.observe(sentinel.current);
    return () => io.disconnect();
  }, [tab, load]);

  return (
    <div className="space-y-4">
      {signedIn ? (
        <div className="inline-flex rounded-lg border p-1 bg-muted">
          <button 
            onClick={() => setTab('foryou')} 
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              tab==='foryou'
                ? 'bg-background ring-1 ring-border text-foreground' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            For you
          </button>
          <button 
            onClick={() => setTab('following')} 
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              tab==='following'
                ? 'bg-background ring-1 ring-border text-foreground' 
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Following
          </button>
        </div>
      ) : null}

      <Grid items={state[tab].items} currentUserId={currentUserId || null} />
      <div ref={sentinel} />
    </div>
  );
}
