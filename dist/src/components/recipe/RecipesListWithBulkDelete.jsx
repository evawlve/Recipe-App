"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipesListWithBulkDelete = RecipesListWithBulkDelete;
const react_1 = require("react");
const SelectableRecipeCard_1 = require("./SelectableRecipeCard");
const BulkDeleteRecipes_1 = require("./BulkDeleteRecipes");
const button_1 = require("@/components/ui/button");
function RecipesListWithBulkDelete({ recipes, currentUserId }) {
    const [selectedRecipes, setSelectedRecipes] = (0, react_1.useState)([]);
    const [isSelectionMode, setIsSelectionMode] = (0, react_1.useState)(false);
    // Only show recipes that belong to the current user for bulk delete
    const userRecipes = currentUserId ? recipes.filter(recipe => recipe.authorId === currentUserId) : [];
    const canSelect = userRecipes.length > 0;
    const handleSelectionChange = (recipeId, selected) => {
        if (selected) {
            setSelectedRecipes(prev => [...prev, recipeId]);
        }
        else {
            setSelectedRecipes(prev => prev.filter(id => id !== recipeId));
        }
    };
    const handleSelectAll = () => {
        if (selectedRecipes.length === userRecipes.length) {
            setSelectedRecipes([]);
        }
        else {
            setSelectedRecipes(userRecipes.map(recipe => recipe.id));
        }
    };
    const handleClearSelection = () => {
        setSelectedRecipes([]);
        setIsSelectionMode(false);
    };
    const toggleSelectionMode = () => {
        setIsSelectionMode(!isSelectionMode);
        setSelectedRecipes([]);
    };
    return (<>
      {/* Selection controls */}
      {canSelect && (<div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button_1.Button variant={isSelectionMode ? "default" : "outline"} onClick={toggleSelectionMode} size="sm">
              {isSelectionMode ? "Cancel Selection" : "Select Recipes"}
            </button_1.Button>
            
            {isSelectionMode && (<>
                <button_1.Button variant="outline" onClick={handleSelectAll} size="sm">
                  {selectedRecipes.length === userRecipes.length ? "Deselect All" : "Select All"}
                </button_1.Button>
                <span className="text-sm text-muted-foreground">
                  {selectedRecipes.length} of {userRecipes.length} selected
                </span>
              </>)}
          </div>
        </div>)}

      {/* Recipes grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        {recipes.map((recipe) => (<SelectableRecipeCard_1.SelectableRecipeCard key={recipe.id} recipe={recipe} isSelected={selectedRecipes.includes(recipe.id)} onSelectionChange={handleSelectionChange} canSelect={isSelectionMode && Boolean(currentUserId) && recipe.authorId === currentUserId} currentUserId={currentUserId}/>))}
      </div>

      {/* Bulk delete component */}
      <BulkDeleteRecipes_1.BulkDeleteRecipes selectedRecipes={selectedRecipes} onClearSelection={handleClearSelection}/>
    </>);
}
