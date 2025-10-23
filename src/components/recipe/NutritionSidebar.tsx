"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Calculator, AlertTriangle, CheckCircle } from "lucide-react";
import { ProvisionalHint } from "./ProvisionalHint";

interface NutritionData {
  totals: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sugarG: number;
  } | null;
  score: {
    value: number;
    label: string;
    breakdown: {
      proteinDensity: number;
      macroBalance: number;
      fiber: number;
      sugar: number;
    };
  } | null;
  provisional?: {
    provisional: boolean;
    provisionalReasons: string[];
  };
  unmappedIngredients: Array<{ id: string; name: string; qty: number; unit: string }>;
}

interface NutritionSidebarProps {
  recipeId: string;
  onOpenMappingModal?: () => void;
}

export function NutritionSidebar({ recipeId, onOpenMappingModal }: NutritionSidebarProps) {
  const [nutritionData, setNutritionData] = useState<NutritionData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState<'general' | 'weight_loss' | 'muscle_gain' | 'maintenance'>('general');

  const loadNutritionData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/nutrition?recipeId=${recipeId}`);
      const result = await response.json();
      
      if (result.success) {
        setNutritionData(result.data);
      } else {
        setError(result.error || 'Failed to load nutrition data');
      }
    } catch (err) {
      setError('Network error loading nutrition data');
    } finally {
      setIsLoading(false);
    }
  };

  const computeNutrition = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/recipes/${recipeId}/compute-nutrition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ goal }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        setNutritionData(result.data);
      } else {
        setError(result.error || 'Failed to compute nutrition');
      }
    } catch (err) {
      setError('Network error computing nutrition');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNutritionData();
  }, [recipeId]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getScoreBadgeVariant = (score: number) => {
    if (score >= 80) return "default";
    if (score >= 60) return "secondary";
    return "destructive";
  };

  if (isLoading && !nutritionData) {
    return (
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Nutrition Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading nutrition data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Nutrition Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {nutritionData?.unmappedIngredients && nutritionData.unmappedIngredients.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <p>Some ingredients need to be mapped to nutrition data:</p>
                <ul className="text-sm list-disc list-inside">
                  {nutritionData.unmappedIngredients.slice(0, 3).map((ingredient, index) => (
                    <li key={ingredient.id || `ingredient-${index}`}>{ingredient.name}</li>
                  ))}
                  {nutritionData.unmappedIngredients.length > 3 && (
                    <li key="more-ingredients">...and {nutritionData.unmappedIngredients.length - 3} more</li>
                  )}
                </ul>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {nutritionData && (
          <>
            {!nutritionData.totals && !nutritionData.score && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  No nutrition data yet. Click "Recompute Nutrition" to calculate.
                </p>
              </div>
            )}

            {/* Health Score */}
            {nutritionData.score && (
              <div className="text-center">
                <div className="text-2xl font-bold mb-1">
                  <span className={getScoreColor(nutritionData.score.value)}>
                    {nutritionData.score.value}
                  </span>
                  <span className="text-muted-foreground text-sm ml-1">/100</span>
                </div>
                <Badge variant={getScoreBadgeVariant(nutritionData.score.value)}>
                  Health Score
                </Badge>
              </div>
            )}

            {/* Nutrition Totals */}
            {nutritionData.totals && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Calories</span>
                  <span className="text-sm font-bold">{nutritionData.totals.calories}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Protein</span>
                  <span className="text-sm">{nutritionData.totals.proteinG}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Carbs</span>
                  <span className="text-sm">{nutritionData.totals.carbsG}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Fat</span>
                  <span className="text-sm">{nutritionData.totals.fatG}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Fiber</span>
                  <span className="text-sm">{nutritionData.totals.fiberG}g</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm font-medium">Sugar</span>
                  <span className="text-sm">{nutritionData.totals.sugarG}g</span>
                </div>
              </div>
            )}

            {/* Provisional Hint */}
            {nutritionData.provisional && (
              <ProvisionalHint 
                provisional={nutritionData.provisional.provisional}
                provisionalReasons={nutritionData.provisional.provisionalReasons}
              />
            )}

            {/* Score Breakdown */}
            {nutritionData.score && nutritionData.score.breakdown && (
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Protein Density</span>
                  <span className={getScoreColor(nutritionData.score.breakdown.proteinDensity)}>
                    {nutritionData.score.breakdown.proteinDensity}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Macro Balance</span>
                  <span className={getScoreColor(nutritionData.score.breakdown.macroBalance)}>
                    {nutritionData.score.breakdown.macroBalance}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Fiber</span>
                  <span className={getScoreColor(nutritionData.score.breakdown.fiber)}>
                    {nutritionData.score.breakdown.fiber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Sugar</span>
                  <span className={getScoreColor(nutritionData.score.breakdown.sugar)}>
                    {nutritionData.score.breakdown.sugar}
                  </span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Action Buttons */}
        <div className="space-y-2">
          <Button 
            onClick={computeNutrition} 
            disabled={isLoading}
            className="w-full"
            size="sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Computing...
              </>
            ) : (
              <>
                <Calculator className="h-4 w-4 mr-2" />
                Recompute Nutrition
              </>
            )}
          </Button>

          {onOpenMappingModal && (
            <Button 
              onClick={onOpenMappingModal}
              variant="outline"
              className="w-full"
              size="sm"
            >
              Map Ingredients
            </Button>
          )}

          {nutritionData?.unmappedIngredients && nutritionData.unmappedIngredients.length === 0 && (
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <CheckCircle className="h-4 w-4" />
              All ingredients mapped automatically
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
