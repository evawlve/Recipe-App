"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RecipesPage;
const db_1 = require("@/lib/db");
const button_1 = require("@/components/ui/button");
const card_1 = require("@/components/ui/card");
const RecipesListWithBulkDelete_1 = require("@/components/recipe/RecipesListWithBulkDelete");
const SearchBox_1 = require("@/components/recipes/SearchBox");
const TagFilters_1 = require("@/components/recipes/TagFilters");
const auth_1 = require("@/lib/auth");
const ScrollToTop_1 = require("@/components/ScrollToTop");
const link_1 = __importDefault(require("next/link"));
async function RecipesPage({ searchParams }) {
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
    const currentUser = await (0, auth_1.getCurrentUser)();
    // Get saved collection for current user if signed in
    let savedCollectionId = null;
    if (currentUser) {
        try {
            const { ensureSavedCollection } = await Promise.resolve().then(() => __importStar(require("@/lib/collections")));
            savedCollectionId = await ensureSavedCollection(currentUser.id);
        }
        catch (error) {
            console.error("Error getting saved collection:", error);
        }
    }
    // Build the where clause for search and tags
    const whereClause = {
        AND: [
            searchQuery
                ? {
                    OR: [
                        { title: { contains: searchQuery, mode: "insensitive" } },
                        { bodyMd: { contains: searchQuery, mode: "insensitive" } },
                        {
                            tags: {
                                some: {
                                    tag: {
                                        OR: [
                                            { label: { contains: searchQuery, mode: "insensitive" } },
                                            { slug: { contains: searchQuery, mode: "insensitive" } },
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
        db_1.prisma.recipe.findMany({
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
                        id: true,
                        name: true,
                        username: true,
                        displayName: true,
                        avatarKey: true,
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
        db_1.prisma.recipe.count({
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
    return (<>
      <ScrollToTop_1.ScrollToTop />
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
        <SearchBox_1.SearchBox initialQuery={searchQuery}/>
        <TagFilters_1.TagFilters selectedTags={selectedTags}/>
      </div>

      {recipes.length === 0 ? (<card_1.Card>
          <card_1.CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold text-text mb-2">No recipes found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? `No recipes match your search for "${searchQuery}"`
                : "No recipes have been created yet"}
            </p>
            {!searchQuery && (<button_1.Button asChild>
                <link_1.default href="/recipes/new">Create your first recipe</link_1.default>
              </button_1.Button>)}
          </card_1.CardContent>
        </card_1.Card>) : (<>
          <RecipesListWithBulkDelete_1.RecipesListWithBulkDelete recipes={recipesWithSavedState} currentUserId={currentUser?.id || null}/>

          {/* Pagination */}
          {totalPages > 1 && (<div className="flex items-center justify-center gap-2">
              <button_1.Button variant="outline" disabled={!hasPrevPage} asChild={hasPrevPage}>
                {hasPrevPage ? (<link_1.default href={`/recipes?${(() => {
                        const params = new URLSearchParams();
                        if (searchQuery)
                            params.set("q", searchQuery);
                        if (selectedTags.length > 0) {
                            selectedTags.forEach(tag => params.append("tags", tag));
                        }
                        params.set("page", (currentPage - 1).toString());
                        return params.toString();
                    })()}`}>
                    Previous
                  </link_1.default>) : ("Previous")}
              </button_1.Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                        pageNum = i + 1;
                    }
                    else if (currentPage <= 3) {
                        pageNum = i + 1;
                    }
                    else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i;
                    }
                    else {
                        pageNum = currentPage - 2 + i;
                    }
                    return (<button_1.Button key={pageNum} variant={pageNum === currentPage ? "default" : "outline"} size="sm" asChild={pageNum !== currentPage}>
                      {pageNum === currentPage ? (pageNum) : (<link_1.default href={`/recipes?${(() => {
                                const params = new URLSearchParams();
                                if (searchQuery)
                                    params.set("q", searchQuery);
                                if (selectedTags.length > 0) {
                                    selectedTags.forEach(tag => params.append("tags", tag));
                                }
                                params.set("page", pageNum.toString());
                                return params.toString();
                            })()}`}>
                          {pageNum}
                        </link_1.default>)}
                    </button_1.Button>);
                })}
              </div>

              <button_1.Button variant="outline" disabled={!hasNextPage} asChild={hasNextPage}>
                {hasNextPage ? (<link_1.default href={`/recipes?${(() => {
                        const params = new URLSearchParams();
                        if (searchQuery)
                            params.set("q", searchQuery);
                        if (selectedTags.length > 0) {
                            selectedTags.forEach(tag => params.append("tags", tag));
                        }
                        params.set("page", (currentPage + 1).toString());
                        return params.toString();
                    })()}`}>
                    Next
                  </link_1.default>) : ("Next")}
              </button_1.Button>
            </div>)}
        </>)}
      </div>
    </>);
}
