"use client";
import { useState } from "react";
import { SelectableRecipeCard } from "./SelectableRecipeCard";
import { BulkDeleteRecipes } from "./BulkDeleteRecipes";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";

interface RecipesListWithBulkDeleteProps {
  recipes: any[];
  currentUserId: string;
}

export function RecipesListWithBulkDelete({ recipes, currentUserId }: RecipesListWithBulkDeleteProps) {
  const [selectedRecipes, setSelectedRecipes] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Only show recipes that belong to the current user for bulk delete
  const userRecipes = recipes.filter(recipe => recipe.authorId === currentUserId);
  const canSelect = userRecipes.length > 0;

  const handleSelectionChange = (recipeId: string, selected: boolean) => {
    if (selected) {
      setSelectedRecipes(prev => [...prev, recipeId]);
    } else {
      setSelectedRecipes(prev => prev.filter(id => id !== recipeId));
    }
  };

  const handleSelectAll = () => {
    if (selectedRecipes.length === userRecipes.length) {
      setSelectedRecipes([]);
    } else {
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

  return (
    <>
      {/* Selection controls */}
      {canSelect && (
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              onClick={toggleSelectionMode}
              size="sm"
            >
              {isSelectionMode ? "Cancel Selection" : "Select Recipes"}
            </Button>
            
            {isSelectionMode && (
              <>
                <Button
                  variant="outline"
                  onClick={handleSelectAll}
                  size="sm"
                >
                  {selectedRecipes.length === userRecipes.length ? "Deselect All" : "Select All"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedRecipes.length} of {userRecipes.length} selected
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Recipes grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
        {recipes.map((recipe) => (
          <SelectableRecipeCard
            key={recipe.id}
            recipe={recipe}
            isSelected={selectedRecipes.includes(recipe.id)}
            onSelectionChange={handleSelectionChange}
            canSelect={isSelectionMode && recipe.authorId === currentUserId}
          />
        ))}
      </div>

      {/* Bulk delete component */}
      <BulkDeleteRecipes
        selectedRecipes={selectedRecipes}
        onClearSelection={handleClearSelection}
      />
    </>
  );
}
