import { prisma } from "@/lib/db";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecipesListWithBulkDelete } from "@/components/recipe/RecipesListWithBulkDelete";
import { SearchBox } from "@/components/recipes/SearchBox";
import { TagFilters } from "@/components/recipes/TagFilters";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

interface RecipesPageProps {
  searchParams: Promise<{
    q?: string;
    tags?: string | string[];
    page?: string;
  }>;
}

export default async function RecipesPage({ searchParams }: RecipesPageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams.q || "";
  const selectedTags = Array.isArray(resolvedSearchParams.tags) 
    ? resolvedSearchParams.tags 
    : resolvedSearchParams.tags 
    ? [resolvedSearchParams.tags] 
    : [];
  const currentPage = parseInt(resolvedSearchParams.page || "1", 10);
  const itemsPerPage = 12;
  const skip = (currentPage - 1) * itemsPerPage;

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

  // Build the where clause for search and tags
  const whereClause = {
    AND: [
      searchQuery
        ? {
            OR: [
              { title: { contains: searchQuery, mode: "insensitive" as const } },
              { bodyMd: { contains: searchQuery, mode: "insensitive" as const } },
              {
                tags: {
                  some: {
                    tag: {
                      OR: [
                        { label: { contains: searchQuery, mode: "insensitive" as const } },
                        { slug: { contains: searchQuery, mode: "insensitive" as const } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {},
      selectedTags.length > 0
        ? {
            tags: {
              some: {
                tag: {
                  slug: { in: selectedTags },
                },
              },
            },
          }
        : {},
    ],
  };

  // Fetch recipes with relations
  const [recipes, totalCount] = await Promise.all([
    prisma.recipe.findMany({
      where: whereClause,
      include: {
        photos: {
          select: {
            id: true,
            s3Key: true,
            width: true,
            height: true,
          },
        },
        nutrition: {
          select: {
            calories: true,
            proteinG: true,
            carbsG: true,
            fatG: true,
          },
        },
        author: {
          select: {
            name: true,
          },
        },
        tags: {
          include: {
            tag: {
              select: {
                id: true,
                slug: true,
                label: true,
              },
            },
          },
        },
        _count: {
          select: { likes: true, comments: true },
        },
        ...(savedCollectionId ? {
          collections: {
            where: {
              collectionId: savedCollectionId
            },
            select: {
              collectionId: true
            }
          }
        } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: itemsPerPage,
    }),
    prisma.recipe.count({
      where: whereClause,
    }),
  ]);

  // Process recipes to add saved state
  const recipesWithSavedState = recipes.map(recipe => ({
    ...recipe,
    savedByMe: savedCollectionId ? recipe.collections?.length > 0 : false
  }));

  const totalPages = Math.ceil(totalCount / itemsPerPage);
  const hasNextPage = currentPage < totalPages;
  const hasPrevPage = currentPage > 1;

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text mb-4">Recipes</h1>
        <p className="text-muted-foreground">
          {totalCount} recipe{totalCount !== 1 ? "s" : ""} found
          {searchQuery && ` for "${searchQuery}"`}
          {selectedTags.length > 0 && ` with tags: ${selectedTags.join(", ")}`}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="mb-8 space-y-6">
        <SearchBox initialQuery={searchQuery} />
        <TagFilters selectedTags={selectedTags} />
      </div>

      {recipes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold text-text mb-2">No recipes found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? `No recipes match your search for "${searchQuery}"`
                : "No recipes have been created yet"}
            </p>
            {!searchQuery && (
              <Button asChild>
                <Link href="/recipes/new">Create your first recipe</Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <RecipesListWithBulkDelete 
            recipes={recipesWithSavedState} 
            currentUserId={currentUser?.id || null} 
          />

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button
                variant="outline"
                disabled={!hasPrevPage}
                asChild={hasPrevPage}
              >
                {hasPrevPage ? (
                  <Link
                    href={`/recipes?${(() => {
                      const params = new URLSearchParams();
                      if (searchQuery) params.set("q", searchQuery);
                      if (selectedTags.length > 0) {
                        selectedTags.forEach(tag => params.append("tags", tag));
                      }
                      params.set("page", (currentPage - 1).toString());
                      return params.toString();
                    })()}`}
                  >
                    Previous
                  </Link>
                ) : (
                  "Previous"
                )}
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (currentPage <= 3) {
                    pageNum = i + 1;
                  } else if (currentPage >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = currentPage - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === currentPage ? "default" : "outline"}
                      size="sm"
                      asChild={pageNum !== currentPage}
                    >
                      {pageNum === currentPage ? (
                        pageNum
                      ) : (
                        <Link
                          href={`/recipes?${(() => {
                            const params = new URLSearchParams();
                            if (searchQuery) params.set("q", searchQuery);
                            if (selectedTags.length > 0) {
                              selectedTags.forEach(tag => params.append("tags", tag));
                            }
                            params.set("page", pageNum.toString());
                            return params.toString();
                          })()}`}
                        >
                          {pageNum}
                        </Link>
                      )}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                disabled={!hasNextPage}
                asChild={hasNextPage}
              >
                {hasNextPage ? (
                  <Link
                    href={`/recipes?${(() => {
                      const params = new URLSearchParams();
                      if (searchQuery) params.set("q", searchQuery);
                      if (selectedTags.length > 0) {
                        selectedTags.forEach(tag => params.append("tags", tag));
                      }
                      params.set("page", (currentPage + 1).toString());
                      return params.toString();
                    })()}`}
                  >
                    Next
                  </Link>
                ) : (
                  "Next"
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
