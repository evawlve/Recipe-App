"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SavedPage;
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const collections_1 = require("@/lib/collections");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const RecipeCard_1 = require("@/components/recipe/RecipeCard");
const link_1 = __importDefault(require("next/link"));
const navigation_1 = require("next/navigation");
async function SavedPage() {
    const currentUser = await (0, auth_1.getCurrentUser)();
    if (!currentUser) {
        (0, navigation_1.redirect)("/signin");
    }
    // Get or create the user's Saved collection
    const savedCollectionId = await (0, collections_1.ensureSavedCollection)(currentUser.id);
    // Fetch saved recipes with relations
    const savedRecipes = await db_1.prisma.recipe.findMany({
        where: {
            collections: {
                some: {
                    collectionId: savedCollectionId
                }
            }
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
            _count: {
                select: { likes: true, comments: true },
            },
        },
        orderBy: {
            createdAt: "desc",
        },
    });
    // Add saved state to recipes (they're all saved by definition)
    const recipesWithSavedState = savedRecipes.map(recipe => ({
        ...recipe,
        savedByMe: true
    }));
    return (<div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <h1 className="text-3xl font-bold text-text">Saved</h1>
          <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm rounded-full">
            {savedRecipes.length} recipe{savedRecipes.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-muted-foreground">
          Your collection of saved recipes
        </p>
      </div>

      {savedRecipes.length === 0 ? (<card_1.Card>
          <card_1.CardContent className="flex flex-col items-center justify-center py-12">
            <h3 className="text-lg font-semibold text-text mb-2">No saved recipes yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Start exploring recipes and save the ones you like!
            </p>
            <button_1.Button asChild>
              <link_1.default href="/recipes">Browse Recipes</link_1.default>
            </button_1.Button>
          </card_1.CardContent>
        </card_1.Card>) : (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {recipesWithSavedState.map((recipe) => (<RecipeCard_1.RecipeCard key={recipe.id} recipe={recipe} currentUserId={currentUser.id}/>))}
        </div>)}
    </div>);
}
