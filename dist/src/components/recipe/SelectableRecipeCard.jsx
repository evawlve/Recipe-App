"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectableRecipeCard = SelectableRecipeCard;
const react_1 = require("react");
const RecipeCard_1 = require("./RecipeCard");
const checkbox_1 = require("@/components/ui/checkbox");
function SelectableRecipeCard({ recipe, isSelected, onSelectionChange, canSelect, currentUserId }) {
    const [isHovered, setIsHovered] = (0, react_1.useState)(false);
    const handleSelectionChange = (checked) => {
        onSelectionChange(recipe.id, checked);
    };
    if (!canSelect) {
        return <RecipeCard_1.RecipeCard recipe={recipe} currentUserId={currentUserId}/>;
    }
    return (<div className="relative" onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      {/* Selection checkbox overlay */}
      <div className={`absolute top-2 left-2 z-10 transition-opacity ${isSelected || isHovered ? 'opacity-100' : 'opacity-0'}`}>
        <checkbox_1.Checkbox checked={isSelected} onCheckedChange={handleSelectionChange} className="bg-background/90 border-2 border-primary"/>
      </div>

      {/* Selection indicator */}
      {isSelected && (<div className="absolute top-2 right-2 z-10 bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
          ✓
        </div>)}

      {/* Recipe card */}
      <div className={isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}>
        <RecipeCard_1.RecipeCard recipe={recipe} currentUserId={currentUserId}/>
      </div>
    </div>);
}
