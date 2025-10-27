'use client';
import * as React from 'react';
import { imageSrcForKey } from '@/lib/images';

type Creator = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  mutualFollowers: Array<{ id: string; username: string | null; name: string | null }>;
  totalMutualFollowers: number;
};


export function FollowingEmpty() {
  const [creators, setCreators] = React.useState<Creator[]|null>(null);

  React.useEffect(() => {
    if (creators === null) {
      fetch('/api/discover/suggest-creators', { cache: 'no-store' })
        .then(r=>r.json())
        .then(d=>setCreators(d.items||[]));
    }
  }, [creators]);

  return (
    <div className="flex gap-4 p-4 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4">
      {(creators ?? Array.from({length:8})).map((u:Creator, i:number) => u ? (
        <CreatorCard key={u.id} user={u} />
      ) : <CreatorSkeleton key={i} />)}
      {creators && creators.length===0 && <EmptyHint />}
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="text-sm text-muted-foreground p-6 text-center">
      No suggestions yet—create some recipes to help us find creators for you!
    </div>
  );
}

function CreatorCard({ user }: { user: Creator }) {
  const [following, setFollowing] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const handleFollow = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const response = await fetch(`/api/follow/${user.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      if (response.ok) {
        setFollowing(true);
      } else {
        console.error('Failed to follow user');
      }
    } catch (error) {
      console.error('Error following user:', error);
    } finally {
      setLoading(false);
    }
  };

  const hasName = user.name && user.name.trim() !== '';
  const displayName = hasName ? user.name : user.username || 'Creator';
  const displayUsername = hasName && user.username ? `@${user.username}` : null;
  
  const mutualFollowersText = user.totalMutualFollowers > 0 
    ? user.totalMutualFollowers === 1 
      ? `followed by ${user.mutualFollowers[0].username || user.mutualFollowers[0].name}`
      : `followed by ${user.mutualFollowers[0].username || user.mutualFollowers[0].name} + ${user.totalMutualFollowers - 1} others`
    : null;

  return (
    <div className="min-w-[200px] max-w-[250px] snap-start text-center">
      <a 
        href={`/u/${user.username || user.id}`}
        className="block"
      >
        <img 
          src={user.image || '/avatar.png'} 
          alt="" 
          className="h-20 w-20 rounded-full object-cover hover:opacity-80 transition-opacity cursor-pointer mx-auto mb-3" 
        />
      </a>
      
      <a 
        href={`/u/${user.username || user.id}`}
        className="block hover:underline mb-2"
      >
        <div className="text-sm font-medium truncate">
          {displayName}
        </div>
        {displayUsername && (
          <div className="text-xs text-muted-foreground truncate">
            {displayUsername}
          </div>
        )}
      </a>

      {mutualFollowersText && (
        <div className="text-xs text-muted-foreground mb-3 truncate">
          {mutualFollowersText}
        </div>
      )}

      <form onSubmit={handleFollow}>
        <button 
          type="submit"
          disabled={loading || following}
          className="w-full px-3 py-1 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Following...' : following ? 'Following' : 'Follow'}
        </button>
      </form>
    </div>
  );
}

function CreatorSkeleton() { 
  return (
    <div className="min-w-[200px] max-w-[250px] snap-start text-center">
      <div className="h-20 w-20 rounded-full bg-muted animate-pulse mx-auto mb-3" />
      <div className="h-4 bg-muted rounded animate-pulse mb-2" />
      <div className="h-3 bg-muted rounded animate-pulse mb-3" />
      <div className="h-8 bg-muted rounded animate-pulse" />
    </div>
  ); 
}
