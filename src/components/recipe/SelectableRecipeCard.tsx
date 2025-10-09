"use client";
import { useState } from "react";
import { RecipeCard } from "./RecipeCard";
import { Checkbox } from "@/components/ui/checkbox";

interface SelectableRecipeCardProps {
  recipe: any;
  isSelected: boolean;
  onSelectionChange: (recipeId: string, selected: boolean) => void;
  canSelect: boolean;
  currentUserId?: string | null;
}

export function SelectableRecipeCard({ 
  recipe, 
  isSelected, 
  onSelectionChange, 
  canSelect,
  currentUserId 
}: SelectableRecipeCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleSelectionChange = (checked: boolean) => {
    onSelectionChange(recipe.id, checked);
  };

  if (!canSelect) {
    return <RecipeCard recipe={recipe} currentUserId={currentUserId} />;
  }

  return (
    <div 
      className="relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Selection checkbox overlay */}
      <div className={`absolute top-2 left-2 z-10 transition-opacity ${
        isSelected || isHovered ? 'opacity-100' : 'opacity-0'
      }`}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={handleSelectionChange}
          className="bg-background/90 border-2 border-primary"
        />
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
          ✓
        </div>
      )}

      {/* Recipe card */}
      <div className={isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}>
        <RecipeCard recipe={recipe} currentUserId={currentUserId} />
      </div>
    </div>
  );
}
