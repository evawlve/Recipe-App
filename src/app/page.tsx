import { getTrendingRecipes } from '@/lib/feeds/trending';
import { HomeSection } from '@/components/home/HomeSection';
import { TrendingRail } from '@/components/home/TrendingRail';
import { SearchBar } from '@/components/home/SearchBar';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { getCurrentUser } from '@/lib/auth';
import { ErrorBoundary as ClientErrorBoundary } from '@/components/obs/ErrorBoundary';
// Lazy-loaded components
import { FollowingEmpty } from '@/components/home/FollowingEmpty';
import { FeedTabs } from '@/components/home/FeedTabs';

// Enable ISR with 60-second revalidation for better performance
export const revalidate = 60;

// Allow dynamic user content while caching the rest
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Note: OAuth callbacks with code parameter are handled by middleware
  // which rewrites them to /auth/callback route handler
  // This page should never receive a code parameter due to the middleware rewrite
  
  // Parallelize data fetching for better performance.
  // Trending must not take down the whole page: the Vercel deployment's
  // database can lag behind the self-hosted schema (e.g. missing Like/Comment
  // tables → P2021), and the homepage still needs to render without it.
  const [trending, currentUser] = await Promise.all([
    getTrendingRecipes({ limit: 12 }).catch((err) => {
      console.error('getTrendingRecipes failed; rendering homepage without trending rail:', err);
      return [];
    }),
    getCurrentUser().catch(() => null), // Don't fail if user fetch fails
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-10">
      {/* Search bar */}
      <SearchBar />

      {trending.length > 0 && (
        <HomeSection title="Trending Recipes" href="/recipes?sort=new">
          <TrendingRail>
            {trending.map((r, index) => (
              <div key={r.id} className="min-w-[280px] max-w-[320px] snap-start">
                <RecipeCard
                  recipe={r}
                  currentUserId={currentUser?.id || null}
                  isPriority={index < 3}
                />
              </div>
            ))}
          </TrendingRail>
        </HomeSection>
      )}

      {currentUser && (
        <HomeSection title="Suggested Creators">
          <FollowingEmpty />
        </HomeSection>
      )}

      <HomeSection title={currentUser ? 'For you · Following' : 'For you'}>
        <ClientErrorBoundary>
          <FeedTabs signedIn={!!currentUser} currentUserId={currentUser?.id || null} />
        </ClientErrorBoundary>
      </HomeSection>
    </div>
  );
}
