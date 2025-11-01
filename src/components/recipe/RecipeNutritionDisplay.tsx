"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NutritionBreakdownModal } from "./NutritionBreakdownModal";
import { BarChart3 } from "lucide-react";

interface RecipeNutritionDisplayProps {
  recipeId: string;
  servings: number;
  isAuthor?: boolean;
  fallbackNutrition?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number | null;
    sugarG: number | null;
    healthScore: number | null;
  } | null;
}

// Helper function for score colors
function getScoreColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

export function RecipeNutritionDisplay({ 
  recipeId, 
  servings, 
  isAuthor = false,
  fallbackNutrition 
}: RecipeNutritionDisplayProps) {
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);

  // Use pre-computed nutrition data directly from the database
  // No need to recompute on every page view - computation happens when ingredients/mappings change
  const displayNutrition = fallbackNutrition;
  const displayScore = fallbackNutrition?.healthScore ? {
    value: fallbackNutrition.healthScore,
    label: fallbackNutrition.healthScore >= 80 ? 'great' : fallbackNutrition.healthScore >= 60 ? 'good' : fallbackNutrition.healthScore >= 40 ? 'ok' : 'poor',
    breakdown: null
  } : null;

  // If no nutrition data is available, don't render anything
  if (!displayNutrition) {
    return null;
  }

  return (
    <Card className="sticky top-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Nutrition Facts</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsBreakdownModalOpen(true)}
            className="flex items-center gap-2"
          >
            <BarChart3 className="h-4 w-4" />
            View Breakdown
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Health Score */}
        {displayScore && (
          <div className="text-center">
            <div className="text-2xl font-bold mb-1">
              <span className={getScoreColor(displayScore.value)}>
                {displayScore.value}
              </span>
              <span className="text-muted-foreground text-sm ml-1">/100</span>
            </div>
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              Health Score
            </div>
          </div>
        )}

        {/* Nutrition Totals */}
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm font-medium">Calories</span>
            <span className="text-sm font-bold">{displayNutrition.calories}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Protein</span>
            <span className="text-sm">{displayNutrition.proteinG.toFixed(1)}g</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Carbs</span>
            <span className="text-sm">{displayNutrition.carbsG.toFixed(1)}g</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Fat</span>
            <span className="text-sm">{displayNutrition.fatG.toFixed(1)}g</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Fiber</span>
            <span className="text-sm">{displayNutrition.fiberG?.toFixed(1) ?? 'N/A'}g</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm font-medium">Sugar</span>
            <span className="text-sm">{displayNutrition.sugarG?.toFixed(1) ?? 'N/A'}g</span>
          </div>
        </div>
        
        {/* Score Breakdown - only show if we have detailed breakdown data */}
        {displayScore && displayScore.breakdown && (
          <div className="pt-4 border-t border-border">
            <div className="text-xs text-muted-foreground mb-2">Score Breakdown</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Protein Density</span>
                <span className={getScoreColor(displayScore.breakdown.proteinDensity)}>
                  {displayScore.breakdown.proteinDensity}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Macro Balance</span>
                <span className={getScoreColor(displayScore.breakdown.macroBalance)}>
                  {displayScore.breakdown.macroBalance}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Fiber</span>
                <span className={getScoreColor(displayScore.breakdown.fiber)}>
                  {displayScore.breakdown.fiber}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Sugar</span>
                <span className={getScoreColor(displayScore.breakdown.sugar)}>
                  {displayScore.breakdown.sugar}
                </span>
              </div>
            </div>
          </div>
        )}
        
        <div className="pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            Per serving • {servings} serving{servings !== 1 ? 's' : ''}
          </div>
        </div>
      </CardContent>
      
      {/* Breakdown Modal */}
      <NutritionBreakdownModal
        isOpen={isBreakdownModalOpen}
        onClose={() => setIsBreakdownModalOpen(false)}
        recipeId={recipeId}
        isAuthor={isAuthor}
      />
    </Card>
  );
}
