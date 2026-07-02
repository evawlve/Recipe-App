import { parseQuery, getTagIdsByNsAndSlug, fetchRecipePage } from "@/lib/recipes/query";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth";
import { ScrollToTop } from "@/components/ScrollToTop";
import { Filters } from "./_components/Filters";
import { LoadMore } from "./_components/LoadMore";
import { RecipeSearchBar } from "@/components/recipes/RecipeSearchBar";
import { ExploreTiles } from "./_components/ExploreTiles";
import { ClearFiltersButton } from "./_components/ClearFiltersButton";
import Link from "next/link";

interface RecipesPageProps {
  searchParams: Promise<{
    ns?: string;
    tags?: string;
    sort?: string;
    kcalMax?: string;
    prepTime?: string;
    cursor?: string;
    search?: string;
  }>;
}

export default async function RecipesPage({ searchParams }: RecipesPageProps) {
  const resolvedSearchParams = await searchParams;
  const { ns, tags, sort, kcalMax, prepTime, cursor, search } = parseQuery(resolvedSearchParams);
  
  // Debug logging
  console.log('Search params:', resolvedSearchParams);
  console.log('Parsed query:', { ns, tags, sort, kcalMax, prepTime, cursor, search });
  
  // For the new multi-select approach, we don't need namespaces in the query
  // since we're selecting tags directly
  const tagIds = await getTagIdsByNsAndSlug([], tags);
  console.log('Tag IDs:', tagIds);
  
  const { items: recipes, nextCursor } = await fetchRecipePage({ tagIds, kcalMax, prepTime, sort, cursor, search });

  // Get current user for bulk delete functionality
  const currentUser = await getCurrentUser();
  
  // Get saved collection for current user if signed in
  let savedCollectionId: string | null = null;
  if (currentUser) {
    try {
      const { ensureSavedCollection } = await import("@/lib/collections");
      savedCollectionId = await ensureSavedCollection(currentUser.id);
    } catch (error) {
      console.error("Error getting saved collection:", error);
    }
  }

  // Process recipes to add saved state and liked state
  const recipesWithSavedState = recipes.map(recipe => ({
    ...recipe,
    savedByMe: false, // Will be handled by SaveButton component
    likedByMe: false  // Will be handled by RecipeCard component
  }));

  return (
    <>
      <ScrollToTop />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h1 className="text-3xl font-bold text-text">Explore Recipes</h1>
            <Button asChild size="sm">
              <Link href="/recipes/new">Create New Recipe</Link>
            </Button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <RecipeSearchBar />
        </div>

        {/* Filters */}
        <div className="mb-8">
          <Filters initial={{ ns, tags, sort, kcalMax, prepTime }} />
        </div>

        {/* Explore Tiles */}
        <div className="mb-8">
          <ExploreTiles />
        </div>

        {/* Recipe Count */}
        <div className="mb-6">
          <p className="text-muted-foreground">
            {recipes.length} recipe{recipes.length !== 1 ? "s" : ""} found
            {search && ` for "${search}"`}
            {tags.length > 0 && ` with tags: ${tags.join(", ")}`}
            {kcalMax && kcalMax < 1000 && ` under ${kcalMax} calories`}
          </p>
        </div>

        {recipes.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <h3 className="text-lg font-semibold text-text mb-2">No recipes found</h3>
              <p className="text-muted-foreground text-center mb-4">
                No recipes match your current filters. Try adjusting your search criteria.
              </p>
              <ClearFiltersButton />
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Recipe Grid */}
            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {recipesWithSavedState.map(recipe => (
                <RecipeCard 
                  key={recipe.id} 
                  recipe={recipe} 
                  currentUserId={currentUser?.id || null}
                />
              ))}
            </div>

            {/* Infinite Scroll Load More */}
            {nextCursor && <LoadMore cursor={nextCursor} />}
          </>
        )}
      </div>
    </>
  );
}
