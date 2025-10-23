"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NutritionBreakdownModal = NutritionBreakdownModal;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const dialog_1 = require("@/components/ui/dialog");
const card_1 = require("@/components/ui/card");
const badge_1 = require("@/components/ui/badge");
const button_1 = require("@/components/ui/button");
const lucide_react_1 = require("lucide-react");
function NutritionBreakdownModal({ isOpen, onClose, recipeId, isAuthor = false }) {
    const [ingredients, setIngredients] = (0, react_1.useState)([]);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const router = (0, navigation_1.useRouter)();
    const loadIngredients = async () => {
        if (!isOpen)
            return;
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/recipes/${recipeId}/ingredients`);
            const result = await response.json();
            if (result.success) {
                setIngredients(result.data);
            }
            else {
                setError(result.error || 'Failed to load ingredients');
            }
        }
        catch (err) {
            setError('Network error loading ingredients');
        }
        finally {
            setIsLoading(false);
        }
    };
    (0, react_1.useEffect)(() => {
        if (isOpen) {
            loadIngredients();
        }
    }, [isOpen, recipeId]);
    const getConfidenceColor = (confidence) => {
        if (confidence >= 0.8)
            return "bg-green-100 text-green-800";
        if (confidence >= 0.6)
            return "bg-yellow-100 text-yellow-800";
        return "bg-red-100 text-red-800";
    };
    const getConfidenceLabel = (confidence) => {
        if (confidence >= 0.8)
            return "High";
        if (confidence >= 0.6)
            return "Medium";
        return "Low";
    };
    const getNutritionBadges = (nutrition) => {
        if (!nutrition)
            return [];
        const badges = [];
        const proteinDensity = nutrition.calories > 0 ? (nutrition.proteinG / (nutrition.calories / 100)) : 0;
        const fiberPer100kcal = nutrition.calories > 0 ? (nutrition.fiberG / (nutrition.calories / 100)) : 0;
        const sugarPer100kcal = nutrition.calories > 0 ? (nutrition.sugarG / (nutrition.calories / 100)) : 0;
        if (proteinDensity >= 8)
            badges.push({ label: "High Protein", color: "bg-green-100 text-green-800" });
        if (fiberPer100kcal >= 3)
            badges.push({ label: "High Fiber", color: "bg-green-100 text-green-800" });
        if (sugarPer100kcal <= 5)
            badges.push({ label: "Low Sugar", color: "bg-green-100 text-green-800" });
        if (nutrition.fatG <= 2)
            badges.push({ label: "Low Fat", color: "bg-blue-100 text-blue-800" });
        if (nutrition.carbsG <= 5)
            badges.push({ label: "Low Carb", color: "bg-purple-100 text-purple-800" });
        return badges;
    };
    const handleEditMappings = () => {
        // Close the modal first
        onClose();
        // Navigate to edit page with mapping modal open
        router.push(`/recipes/${recipeId}/edit?openMapping=true`);
    };
    const mappedIngredients = ingredients.filter(ing => ing.currentMapping);
    const unmappedIngredients = ingredients.filter(ing => !ing.currentMapping);
    return (<dialog_1.Dialog open={isOpen} onOpenChange={onClose}>
      <dialog_1.DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <dialog_1.DialogHeader>
          <div className="flex items-center justify-between">
            <dialog_1.DialogTitle>Nutrition Breakdown</dialog_1.DialogTitle>
            {isAuthor && (<button_1.Button variant="outline" size="sm" onClick={handleEditMappings} className="flex items-center gap-2">
                <lucide_react_1.Edit3 className="h-4 w-4"/>
                Edit Mappings
              </button_1.Button>)}
          </div>
        </dialog_1.DialogHeader>

        {isLoading && (<div className="flex items-center justify-center py-8">
            <lucide_react_1.Loader2 className="h-6 w-6 animate-spin"/>
            <span className="ml-2">Loading ingredients...</span>
          </div>)}

        {error && (<div className="text-center py-8">
            <div className="text-red-600 mb-2">Failed to load ingredients</div>
            <div className="text-sm text-muted-foreground">{error}</div>
          </div>)}

        {!isLoading && !error && (<div className="space-y-6">
            {/* Mapped Ingredients */}
            {mappedIngredients.length > 0 && (<div>
                <h3 className="text-lg font-semibold mb-4">
                  Mapped Ingredients ({mappedIngredients.length})
                </h3>
                <div className="grid gap-4">
                  {mappedIngredients.map((ingredient) => {
                    const nutrition = ingredient.nutrition;
                    const badges = getNutritionBadges(nutrition);
                    const proteinDensity = nutrition && nutrition.calories > 0 ? (nutrition.proteinG / (nutrition.calories / 100)) : 0;
                    return (<card_1.Card key={ingredient.id} className="border-l-4 border-l-green-500">
                        <card_1.CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <card_1.CardTitle className="text-base">
                              {ingredient.qty} {ingredient.unit} {ingredient.name}
                            </card_1.CardTitle>
                            <div className="flex items-center gap-2">
                              {badges.map((badge, index) => (<badge_1.Badge key={index} className={badge.color}>
                                  {badge.label}
                                </badge_1.Badge>))}
                              <badge_1.Badge className={getConfidenceColor(ingredient.currentMapping.confidence)}>
                                {getConfidenceLabel(ingredient.currentMapping.confidence)} Confidence
                              </badge_1.Badge>
                            </div>
                          </div>
                        </card_1.CardHeader>
                        <card_1.CardContent className="pt-0">
                          <div className="space-y-3">
                            <div className="text-sm">
                              <span className="font-medium">Mapped to: </span>
                              <span className="text-muted-foreground">
                                {ingredient.currentMapping.foodBrand
                            ? `${ingredient.currentMapping.foodBrand} - ${ingredient.currentMapping.foodName}`
                            : ingredient.currentMapping.foodName}
                              </span>
                            </div>
                            
                            {nutrition && (<>
                                <div className="text-sm">
                                  <span className="font-medium">Macros: </span>
                                  <span className="text-muted-foreground">
                                    {Math.round(nutrition.calories)} kcal · {nutrition.proteinG.toFixed(1)} P / {nutrition.carbsG.toFixed(1)} C / {nutrition.fatG.toFixed(1)} F
                                  </span>
                                </div>
                                <div className="text-sm">
                                  <span className="font-medium">Protein dens. </span>
                                  <span className="text-muted-foreground">
                                    {proteinDensity.toFixed(1)} g/100 kcal · Fiber {nutrition.fiberG.toFixed(1)} g · Sugar {nutrition.sugarG.toFixed(1)} g
                                  </span>
                                </div>
                              </>)}
                          </div>
                        </card_1.CardContent>
                      </card_1.Card>);
                })}
                </div>
              </div>)}

            {/* Unmapped Ingredients */}
            {unmappedIngredients.length > 0 && (<div>
                <h3 className="text-lg font-semibold mb-4">
                  Unmapped Ingredients ({unmappedIngredients.length})
                </h3>
                <div className="grid gap-4">
                  {unmappedIngredients.map((ingredient) => (<card_1.Card key={ingredient.id} className="border-l-4 border-l-red-500">
                      <card_1.CardHeader className="pb-3">
                        <card_1.CardTitle className="text-base">
                          {ingredient.qty} {ingredient.unit} {ingredient.name}
                        </card_1.CardTitle>
                      </card_1.CardHeader>
                      <card_1.CardContent className="pt-0">
                        <div className="text-sm text-muted-foreground">
                          This ingredient needs to be mapped to a food item for accurate nutrition calculation.
                        </div>
                      </card_1.CardContent>
                    </card_1.Card>))}
                </div>
              </div>)}

            {ingredients.length === 0 && (<div className="text-center py-8">
                <div className="text-muted-foreground">No ingredients found for this recipe.</div>
              </div>)}
          </div>)}
      </dialog_1.DialogContent>
    </dialog_1.Dialog>);
}
