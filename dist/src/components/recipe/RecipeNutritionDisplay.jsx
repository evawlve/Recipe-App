"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecipeNutritionDisplay = RecipeNutritionDisplay;
const react_1 = require("react");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const NutritionBreakdownModal_1 = require("./NutritionBreakdownModal");
const lucide_react_1 = require("lucide-react");
// Helper function for score colors
function getScoreColor(score) {
    if (score >= 80)
        return "text-green-600";
    if (score >= 60)
        return "text-yellow-600";
    return "text-red-600";
}
function RecipeNutritionDisplay({ recipeId, servings, isAuthor = false, fallbackNutrition }) {
    const [nutritionData, setNutritionData] = (0, react_1.useState)(null);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [isBreakdownModalOpen, setIsBreakdownModalOpen] = (0, react_1.useState)(false);
    const loadNutritionData = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/nutrition?recipeId=${recipeId}`);
            const result = await response.json();
            if (result.success) {
                setNutritionData(result.data);
            }
            else {
                setError(result.error || 'Failed to load nutrition data');
            }
        }
        catch (err) {
            setError('Network error loading nutrition data');
        }
        finally {
            setIsLoading(false);
        }
    };
    (0, react_1.useEffect)(() => {
        loadNutritionData();
    }, [recipeId]);
    // Use computed nutrition data if available, otherwise fall back to stored data
    const displayNutrition = nutritionData?.totals || fallbackNutrition;
    const displayScore = nutritionData?.score || (fallbackNutrition?.healthScore ? {
        value: fallbackNutrition.healthScore,
        label: fallbackNutrition.healthScore >= 80 ? 'great' : fallbackNutrition.healthScore >= 60 ? 'good' : fallbackNutrition.healthScore >= 40 ? 'ok' : 'poor',
        breakdown: null
    } : null);
    if (isLoading && !nutritionData) {
        return (<card_1.Card className="sticky top-8">
        <card_1.CardHeader>
          <card_1.CardTitle>Nutrition Facts</card_1.CardTitle>
        </card_1.CardHeader>
        <card_1.CardContent>
          <div className="text-center py-4">
            <div className="text-sm text-muted-foreground">Loading nutrition data...</div>
          </div>
        </card_1.CardContent>
      </card_1.Card>);
    }
    if (error && !fallbackNutrition) {
        return (<card_1.Card className="sticky top-8">
        <card_1.CardHeader>
          <card_1.CardTitle>Nutrition Facts</card_1.CardTitle>
        </card_1.CardHeader>
        <card_1.CardContent>
          <div className="text-center py-4">
            <div className="text-sm text-red-600">Failed to load nutrition data</div>
          </div>
        </card_1.CardContent>
      </card_1.Card>);
    }
    if (!displayNutrition) {
        return null;
    }
    return (<card_1.Card className="sticky top-8">
      <card_1.CardHeader>
        <div className="flex items-center justify-between">
          <card_1.CardTitle>Nutrition Facts</card_1.CardTitle>
          <button_1.Button variant="outline" size="sm" onClick={() => setIsBreakdownModalOpen(true)} className="flex items-center gap-2">
            <lucide_react_1.BarChart3 className="h-4 w-4"/>
            View Breakdown
          </button_1.Button>
        </div>
      </card_1.CardHeader>
      <card_1.CardContent className="space-y-4">
        {/* Health Score */}
        {displayScore && (<div className="text-center">
            <div className="text-2xl font-bold mb-1">
              <span className={getScoreColor(displayScore.value)}>
                {displayScore.value}
              </span>
              <span className="text-muted-foreground text-sm ml-1">/100</span>
            </div>
            <div className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              Health Score
            </div>
          </div>)}

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
        {displayScore && displayScore.breakdown && (<div className="pt-4 border-t border-border">
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
          </div>)}
        
        <div className="pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            Per serving • {servings} serving{servings !== 1 ? 's' : ''}
          </div>
        </div>
      </card_1.CardContent>
      
      {/* Breakdown Modal */}
      <NutritionBreakdownModal_1.NutritionBreakdownModal isOpen={isBreakdownModalOpen} onClose={() => setIsBreakdownModalOpen(false)} recipeId={recipeId} isAuthor={isAuthor}/>
    </card_1.Card>);
}
