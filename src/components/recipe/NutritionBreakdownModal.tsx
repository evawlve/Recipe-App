"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Edit3 } from "lucide-react";

interface MappedIngredient {
  id: string;
  name: string;
  qty: number;
  unit: string;
  currentMapping: {
    foodId: string;
    foodName: string;
    foodBrand: string | null;
    confidence: number;
  } | null;
  nutrition?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sugarG: number;
  };
}

interface NutritionBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipeId: string;
  isAuthor?: boolean;
}

export function NutritionBreakdownModal({ 
  isOpen, 
  onClose, 
  recipeId,
  isAuthor = false
}: NutritionBreakdownModalProps) {
  const [ingredients, setIngredients] = useState<MappedIngredient[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const loadIngredients = async () => {
    if (!isOpen) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/recipes/${recipeId}/ingredients`);
      const result = await response.json();
      
      if (result.success) {
        setIngredients(result.data);
      } else {
        setError(result.error || 'Failed to load ingredients');
      }
    } catch (err) {
      setError('Network error loading ingredients');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadIngredients();
    }
  }, [isOpen, recipeId]);

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return "bg-green-100 text-green-800";
    if (confidence >= 0.6) return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return "High";
    if (confidence >= 0.6) return "Medium";
    return "Low";
  };

  const getNutritionBadges = (nutrition: MappedIngredient['nutrition']) => {
    if (!nutrition) return [];
    
    const badges = [];
    const proteinDensity = nutrition.calories > 0 ? (nutrition.proteinG / (nutrition.calories / 100)) : 0;
    const fiberPer100kcal = nutrition.calories > 0 ? (nutrition.fiberG / (nutrition.calories / 100)) : 0;
    const sugarPer100kcal = nutrition.calories > 0 ? (nutrition.sugarG / (nutrition.calories / 100)) : 0;

    if (proteinDensity >= 8) badges.push({ label: "High Protein", color: "bg-green-100 text-green-800" });
    if (fiberPer100kcal >= 3) badges.push({ label: "High Fiber", color: "bg-green-100 text-green-800" });
    if (sugarPer100kcal <= 5) badges.push({ label: "Low Sugar", color: "bg-green-100 text-green-800" });
    if (nutrition.fatG <= 2) badges.push({ label: "Low Fat", color: "bg-blue-100 text-blue-800" });
    if (nutrition.carbsG <= 5) badges.push({ label: "Low Carb", color: "bg-purple-100 text-purple-800" });

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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Nutrition Breakdown</DialogTitle>
            {isAuthor && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleEditMappings}
                className="flex items-center gap-2"
              >
                <Edit3 className="h-4 w-4" />
                Edit Mappings
              </Button>
            )}
          </div>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading ingredients...</span>
          </div>
        )}

        {error && (
          <div className="text-center py-8">
            <div className="text-red-600 mb-2">Failed to load ingredients</div>
            <div className="text-sm text-muted-foreground">{error}</div>
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-6">
            {/* Mapped Ingredients */}
            {mappedIngredients.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Mapped Ingredients ({mappedIngredients.length})
                </h3>
                <div className="grid gap-4">
                  {mappedIngredients.map((ingredient) => {
                    const nutrition = ingredient.nutrition;
                    const badges = getNutritionBadges(nutrition);
                    const proteinDensity = nutrition && nutrition.calories > 0 ? (nutrition.proteinG / (nutrition.calories / 100)) : 0;
                    
                    return (
                      <Card key={ingredient.id} className="border-l-4 border-l-green-500">
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              {ingredient.qty} {ingredient.unit} {ingredient.name}
                            </CardTitle>
                            <div className="flex items-center gap-2">
                              {badges.map((badge, index) => (
                                <Badge key={index} className={badge.color}>
                                  {badge.label}
                                </Badge>
                              ))}
                              <Badge 
                                className={getConfidenceColor(ingredient.currentMapping!.confidence)}
                              >
                                {getConfidenceLabel(ingredient.currentMapping!.confidence)} Confidence
                              </Badge>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="space-y-3">
                            <div className="text-sm">
                              <span className="font-medium">Mapped to: </span>
                              <span className="text-muted-foreground">
                                {ingredient.currentMapping!.foodBrand 
                                  ? `${ingredient.currentMapping!.foodBrand} - ${ingredient.currentMapping!.foodName}`
                                  : ingredient.currentMapping!.foodName
                                }
                              </span>
                            </div>
                            
                            {nutrition && (
                              <>
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
                              </>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Unmapped Ingredients */}
            {unmappedIngredients.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Unmapped Ingredients ({unmappedIngredients.length})
                </h3>
                <div className="grid gap-4">
                  {unmappedIngredients.map((ingredient) => (
                    <Card key={ingredient.id} className="border-l-4 border-l-red-500">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">
                          {ingredient.qty} {ingredient.unit} {ingredient.name}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="text-sm text-muted-foreground">
                          This ingredient needs to be mapped to a food item for accurate nutrition calculation.
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {ingredients.length === 0 && (
              <div className="text-center py-8">
                <div className="text-muted-foreground">No ingredients found for this recipe.</div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
