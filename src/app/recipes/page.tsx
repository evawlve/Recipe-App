import { prisma } from "@/lib/db";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RecipesListWithBulkDelete } from "@/components/recipe/RecipesListWithBulkDelete";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";

interface RecipesPageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

export default async function RecipesPage({ searchParams }: RecipesPageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams.q || "";
  const currentPage = parseInt(resolvedSearchParams.page || "1", 10);
  const itemsPerPage = 12;
  const skip = (currentPage - 1) * itemsPerPage;

  // Get current user for bulk delete functionality
  const currentUser = await getCurrentUser();

  // Build the where clause for search
  const whereClause = searchQuery
    ? {
        OR: [
          { title: { contains: searchQuery, mode: "insensitive" as const } },
          { bodyMd: { contains: searchQuery, mode: "insensitive" as const } },
        ],
      }
    : {};

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
        </p>
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
            recipes={recipes} 
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
                    href={`/recipes?${new URLSearchParams({
                      ...(searchQuery && { q: searchQuery }),
                      page: (currentPage - 1).toString(),
                    })}`}
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
                          href={`/recipes?${new URLSearchParams({
                            ...(searchQuery && { q: searchQuery }),
                            page: pageNum.toString(),
                          })}`}
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
                    href={`/recipes?${new URLSearchParams({
                      ...(searchQuery && { q: searchQuery }),
                      page: (currentPage + 1).toString(),
                    })}`}
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
