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
exports.default = RecipePage;
const db_1 = require("@/lib/db");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
const PhotoGallery_1 = require("@/components/recipe/PhotoGallery");
const auth_1 = require("@/lib/auth");
const LikeButton_1 = __importDefault(require("@/components/recipe/LikeButton"));
const Comments_1 = __importDefault(require("@/components/recipe/Comments"));
const DeleteRecipeButton_1 = __importDefault(require("@/components/recipe/DeleteRecipeButton"));
const SaveButton_1 = __importDefault(require("@/components/recipe/SaveButton"));
const AuthorLink_1 = require("@/components/recipe/AuthorLink");
const RecipeNutritionDisplay_1 = require("@/components/recipe/RecipeNutritionDisplay");
async function RecipePage({ params }) {
    const resolvedParams = await params;
    const recipe = await db_1.prisma.recipe.findUnique({
        where: {
            id: resolvedParams.id,
        },
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
                    fiberG: true,
                    sugarG: true,
                    healthScore: true,
                    goal: true,
                    computedAt: true,
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
            ingredients: {
                select: {
                    id: true,
                    name: true,
                    qty: true,
                    unit: true,
                },
            },
        },
    });
    if (!recipe) {
        (0, navigation_1.notFound)();
    }
    const current = await (0, auth_1.getCurrentUser)();
    const canDelete = current?.id === recipe.authorId;
    // Get saved state for current user if signed in
    let savedByMe = false;
    if (current) {
        try {
            const { ensureSavedCollection } = await Promise.resolve().then(() => __importStar(require("@/lib/collections")));
            const savedCollectionId = await ensureSavedCollection(current.id);
            const savedRecipe = await db_1.prisma.collectionRecipe.findUnique({
                where: {
                    collectionId_recipeId: {
                        collectionId: savedCollectionId,
                        recipeId: recipe.id
                    }
                }
            });
            savedByMe = Boolean(savedRecipe);
        }
        catch (error) {
            console.error("Error checking saved state:", error);
        }
    }
    const [likeCount, likedByMe, comments] = await Promise.all([
        db_1.prisma.like.count({ where: { recipeId: recipe.id } }),
        current ? db_1.prisma.like.findUnique({ where: { userId_recipeId: { userId: current.id, recipeId: recipe.id } } }).then(Boolean) : Promise.resolve(false),
        db_1.prisma.comment.findMany({
            where: { recipeId: recipe.id },
            orderBy: { createdAt: "desc" },
            take: 20,
            select: { id: true, body: true, createdAt: true, user: { select: { id: true, name: true } } },
        }),
    ]);
    // Debug logging
    console.log('Recipe photos:', recipe.photos);
    console.log('Number of photos:', recipe.photos.length);
    const formatDate = (date) => {
        return new Intl.DateTimeFormat("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
        }).format(date);
    };
    return (<div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <button_1.Button variant="outline" asChild>
            <link_1.default href="/recipes">← Back to Recipes</link_1.default>
          </button_1.Button>
          {canDelete && (<>
              <button_1.Button variant="outline" asChild>
                <link_1.default href={`/recipes/${recipe.id}/edit`}>Edit Recipe</link_1.default>
              </button_1.Button>
              <DeleteRecipeButton_1.default recipeId={recipe.id}/>
            </>)}
        </div>
        
        <h1 className="text-4xl font-bold text-text mb-2">{recipe.title}</h1>
        <div className="flex items-center gap-4 text-muted-foreground">
          <AuthorLink_1.AuthorLink author={recipe.author} currentUserId={current?.id} size="md" showAvatar={true}/>
          <span>•</span>
          <span>{formatDate(recipe.createdAt)}</span>
          <span>•</span>
          <span>{recipe.servings} serving{recipe.servings !== 1 ? 's' : ''}</span>
          <span>•</span>
          <LikeButton_1.default recipeId={recipe.id} initialCount={likeCount} initiallyLiked={Boolean(likedByMe)}/>
          <span>•</span>
          <SaveButton_1.default recipeId={recipe.id} initiallySaved={savedByMe} isAuthenticated={Boolean(current)}/>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="xl:col-span-2 space-y-8">
          {/* Photos Grid */}
          {recipe.photos.length > 0 && (<card_1.Card>
              <card_1.CardHeader>
                <card_1.CardTitle>Photos</card_1.CardTitle>
              </card_1.CardHeader>
              <card_1.CardContent>
                <PhotoGallery_1.PhotoGallery photos={recipe.photos} recipeTitle={recipe.title} canDelete={canDelete}/>
              </card_1.CardContent>
            </card_1.Card>)}

          {/* Nutrition Breakdown - Mobile/Tablet (shown after photos) */}
          <div className="xl:hidden">
            <RecipeNutritionDisplay_1.RecipeNutritionDisplay recipeId={recipe.id} servings={recipe.servings} isAuthor={canDelete} fallbackNutrition={recipe.nutrition}/>
          </div>

          {/* Ingredients */}
          {recipe.ingredients.length > 0 && (<card_1.Card>
              <card_1.CardHeader>
                <card_1.CardTitle>Ingredients</card_1.CardTitle>
              </card_1.CardHeader>
              <card_1.CardContent>
                <ul className="space-y-2">
                  {recipe.ingredients.map((ingredient) => (<li key={ingredient.id} className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {ingredient.qty} {ingredient.unit}
                      </span>
                      <span className="text-text">{ingredient.name}</span>
                    </li>))}
                </ul>
              </card_1.CardContent>
            </card_1.Card>)}

          {/* Recipe Body */}
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>Instructions</card_1.CardTitle>
            </card_1.CardHeader>
            <card_1.CardContent>
              <div className="prose prose-sm max-w-none text-text" dangerouslySetInnerHTML={{
            __html: recipe.bodyMd.replace(/\n/g, '<br>')
        }}/>
            </card_1.CardContent>
          </card_1.Card>

          {/* Comments Section */}
          <card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>Comments</card_1.CardTitle>
            </card_1.CardHeader>
            <card_1.CardContent>
              <Comments_1.default recipeId={recipe.id} initial={comments} canPost={Boolean(current)} currentUserId={current?.id ?? null} recipeAuthorId={recipe.authorId}/>
            </card_1.CardContent>
          </card_1.Card>
        </div>

        {/* Nutrition Sidebar - Desktop only */}
        <div className="hidden xl:block xl:col-span-1">
          <RecipeNutritionDisplay_1.RecipeNutritionDisplay recipeId={recipe.id} servings={recipe.servings} isAuthor={canDelete} fallbackNutrition={recipe.nutrition}/>
        </div>
      </div>
    </div>);
}
