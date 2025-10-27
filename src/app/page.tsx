import { getTrendingRecipes } from '@/lib/feeds/trending';
import { getFollowingRecipes } from '@/lib/feeds/following';
import { HomeSection } from '@/components/home/HomeSection';
import { TrendingRail } from '@/components/home/TrendingRail';
import { FollowingRail } from '@/components/home/FollowingRail';
import { CategoryTile } from '@/components/home/CategoryTile';
import { SearchBar } from '@/components/home/SearchBar';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { getCurrentUser } from '@/lib/auth';

// Force dynamic rendering for pages that use authentication
export const dynamic = 'force-dynamic';

const mealTypeTiles = [
  { label: 'Breakfast', slug: 'breakfast', imageSrc: '/images/cat/breakfast.png' },
  { label: 'Lunch', slug: 'lunch', imageSrc: '/images/cat/lunch.png' },
  { label: 'Dinner', slug: 'dinner', imageSrc: '/images/cat/dinner.png' },
  { label: 'Snacks', slug: 'snack', imageSrc: '/images/cat/snacks.png' },
  { label: 'Desserts', slug: 'dessert', imageSrc: '/images/cat/dessert.png' },
  { label: 'Drinks', slug: 'drinks', imageSrc: '/images/cat/drinks.png' },
];

const cuisineTiles = [
  { label: 'Mexican', slug: 'mexican', imageSrc: '/images/cat/mexican.png' },
  { label: 'Italian', slug: 'italian', imageSrc: '/images/cat/italian.png' },
  { label: 'American', slug: 'american', imageSrc: '/images/cat/american.png' },
  { label: 'Japanese', slug: 'japanese', imageSrc: '/images/cat/japanese.png' },
  { label: 'Greek', slug: 'greek', imageSrc: '/images/cat/greek.png' },
  { label: 'Chinese', slug: 'chinese', imageSrc: '/images/cat/chinese.png' },
];

export default async function HomePage() {
  const trending = await getTrendingRecipes({ limit: 12 });
  const currentUser = await getCurrentUser();
  
  // Get following recipes if user is authenticated
  const followingRecipes = currentUser 
    ? await getFollowingRecipes({ userId: currentUser.id, limit: 12 })
    : [];

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
          <FollowingRail 
            currentUserId={currentUser.id} 
            initialRecipes={followingRecipes}
          />
        </HomeSection>
      )}

      <HomeSection title="Browse by Category" href="/recipes">
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {mealTypeTiles.map(t => (
            <CategoryTile key={t.slug} {...t} />
          ))}
        </div>
      </HomeSection>

      <HomeSection title="Browse by Cuisine" href="/recipes">
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {cuisineTiles.map(t => (
            <CategoryTile key={t.slug} {...t} />
          ))}
        </div>
      </HomeSection>
    </div>
  );
}
