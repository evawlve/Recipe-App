"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = RecipeGrid;
const RecipeCard_1 = require("@/components/recipe/RecipeCard");
const card_1 = require("@/components/ui/card");
function RecipeGrid({ items, currentUserId }) {
    if (items.length === 0) {
        return (<card_1.Card className="rounded-2xl border border-border bg-card shadow-sm p-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No recipes yet</h3>
          <p className="text-muted-foreground">
            Start creating or saving recipes to see them here.
          </p>
        </div>
      </card_1.Card>);
    }
    return (<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {items.map((item) => (<RecipeCard_1.RecipeCard key={item.id} recipe={{
                id: item.id,
                title: item.title,
                bodyMd: "",
                servings: 1,
                authorId: item.author.id,
                createdAt: item.createdAt,
                updatedAt: item.createdAt,
                parentId: null,
                photos: item.photos,
                nutrition: null,
                author: item.author,
                _count: { likes: 0, comments: 0 }
            }} currentUserId={currentUserId}/>))}
    </div>);
}
