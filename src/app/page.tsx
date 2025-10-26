import { getTrendingRecipes } from '@/lib/feeds/trending';
import { HomeSection } from '@/components/home/HomeSection';
import { TrendingRail } from '@/components/home/TrendingRail';
import { CategoryTile } from '@/components/home/CategoryTile';
import { SearchBar } from '@/components/home/SearchBar';
import { RecipeCard } from '@/components/recipe/RecipeCard';
import { getCurrentUser } from '@/lib/auth';

const mealTypeTiles = [
  { label: 'Breakfast', slug: 'breakfast', imageSrc: '/images/cat/breakfast.svg' },
  { label: 'Lunch', slug: 'lunch', imageSrc: '/images/cat/lunch.svg' },
  { label: 'Dinner', slug: 'dinner', imageSrc: '/images/cat/dinner.svg' },
  { label: 'Snacks', slug: 'snack', imageSrc: '/images/cat/snacks.svg' },
  { label: 'Desserts', slug: 'dessert', imageSrc: '/images/cat/dessert.svg' },
  { label: 'Drinks', slug: 'drinks', imageSrc: '/images/cat/drinks.svg' },
];

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

      <HomeSection title="Browse by Category" href="/recipes">
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {mealTypeTiles.map(t => (
            <CategoryTile key={t.slug} {...t} />
          ))}
        </div>
      </HomeSection>
    </div>
  );
}
