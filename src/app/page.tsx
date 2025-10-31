import { getTrendingRecipes } from '@/lib/feeds/trending';
import { HomeSection } from '@/components/home/HomeSection';
import { TrendingRail } from '@/components/home/TrendingRail';
import { FollowingEmpty } from '@/components/home/FollowingEmpty';
import { SearchBar } from '@/components/home/SearchBar';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { FeedTabs } from '@/components/home/FeedTabs';
import { getCurrentUser } from '@/lib/auth';
import { ErrorBoundary as ClientErrorBoundary } from '@/components/obs/ErrorBoundary';

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';


export default async function HomePage() {
  const trending = await getTrendingRecipes({ limit: 12 });
  const currentUser = await getCurrentUser();

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-10">
      {/* Search bar */}
      <SearchBar />

      <HomeSection title="Trending Recipes" href="/recipes?sort=new">
        <TrendingRail>
          {trending.map((r) => (
            <div key={r.id} className="min-w-[280px] max-w-[320px] snap-start">
              <RecipeCard
                recipe={r}
                currentUserId={currentUser?.id || null}
              />
            </div>
          ))}
        </TrendingRail>
      </HomeSection>

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
