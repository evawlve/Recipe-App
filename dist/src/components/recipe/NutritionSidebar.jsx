"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NutritionSidebar = NutritionSidebar;
const react_1 = require("react");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const badge_1 = require("@/components/ui/badge");
const alert_1 = require("@/components/ui/alert");
const lucide_react_1 = require("lucide-react");
const ProvisionalHint_1 = require("./ProvisionalHint");
function NutritionSidebar({ recipeId, onOpenMappingModal }) {
    const [nutritionData, setNutritionData] = (0, react_1.useState)(null);
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [goal, setGoal] = (0, react_1.useState)('general');
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
            }
            else {
                setError(result.error || 'Failed to compute nutrition');
            }
        }
        catch (err) {
            setError('Network error computing nutrition');
        }
        finally {
            setIsLoading(false);
        }
    };
    (0, react_1.useEffect)(() => {
        loadNutritionData();
    }, [recipeId]);
    const getScoreColor = (score) => {
        if (score >= 80)
            return "text-green-600";
        if (score >= 60)
            return "text-yellow-600";
        return "text-red-600";
    };
    const getScoreBadgeVariant = (score) => {
        if (score >= 80)
            return "default";
        if (score >= 60)
            return "secondary";
        return "destructive";
    };
    if (isLoading && !nutritionData) {
        return (<card_1.Card className="w-full">
        <card_1.CardHeader>
          <card_1.CardTitle className="flex items-center gap-2">
            <lucide_react_1.Calculator className="h-5 w-5"/>
            Nutrition Analysis
          </card_1.CardTitle>
        </card_1.CardHeader>
        <card_1.CardContent>
          <div className="flex items-center justify-center py-8">
            <lucide_react_1.Loader2 className="h-6 w-6 animate-spin"/>
            <span className="ml-2">Loading nutrition data...</span>
          </div>
        </card_1.CardContent>
      </card_1.Card>);
    }
    return (<card_1.Card className="w-full">
      <card_1.CardHeader>
        <card_1.CardTitle className="flex items-center gap-2">
          <lucide_react_1.Calculator className="h-5 w-5"/>
          Nutrition Analysis
        </card_1.CardTitle>
      </card_1.CardHeader>
      <card_1.CardContent className="space-y-4">
        {error && (<alert_1.Alert variant="destructive">
            <lucide_react_1.AlertTriangle className="h-4 w-4"/>
            <alert_1.AlertDescription>{error}</alert_1.AlertDescription>
          </alert_1.Alert>)}

        {nutritionData?.unmappedIngredients && nutritionData.unmappedIngredients.length > 0 && (<alert_1.Alert>
            <lucide_react_1.AlertTriangle className="h-4 w-4"/>
            <alert_1.AlertDescription>
              <div className="space-y-2">
                <p>Some ingredients need to be mapped to nutrition data:</p>
                <ul className="text-sm list-disc list-inside">
                  {nutritionData.unmappedIngredients.slice(0, 3).map((ingredient, index) => (<li key={ingredient.id}>{ingredient.name}</li>))}
                  {nutritionData.unmappedIngredients.length > 3 && (<li key="more">...and {nutritionData.unmappedIngredients.length - 3} more</li>)}
                </ul>
              </div>
            </alert_1.AlertDescription>
          </alert_1.Alert>)}

        {nutritionData && (<>
            {!nutritionData.totals && !nutritionData.score && (<div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  No nutrition data yet. Click "Recompute Nutrition" to calculate.
                </p>
              </div>)}

            {/* Health Score */}
            {nutritionData.score && (<div className="text-center">
                <div className="text-2xl font-bold mb-1">
                  <span className={getScoreColor(nutritionData.score.value)}>
                    {nutritionData.score.value}
                  </span>
                  <span className="text-muted-foreground text-sm ml-1">/100</span>
                </div>
                <badge_1.Badge variant={getScoreBadgeVariant(nutritionData.score.value)}>
                  Health Score
                </badge_1.Badge>
              </div>)}

            {/* Nutrition Totals */}
            {nutritionData.totals && (<div className="space-y-2">
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
              </div>)}

            {/* Provisional Hint */}
            {nutritionData.provisional && (<ProvisionalHint_1.ProvisionalHint provisional={nutritionData.provisional.provisional} provisionalReasons={nutritionData.provisional.provisionalReasons}/>)}

            {/* Score Breakdown */}
            {nutritionData.score && nutritionData.score.breakdown && (<div className="space-y-1 text-xs">
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
              </div>)}
          </>)}

        {/* Action Buttons */}
        <div className="space-y-2">
          <button_1.Button onClick={computeNutrition} disabled={isLoading} className="w-full" size="sm">
            {isLoading ? (<>
                <lucide_react_1.Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                Computing...
              </>) : (<>
                <lucide_react_1.Calculator className="h-4 w-4 mr-2"/>
                Recompute Nutrition
              </>)}
          </button_1.Button>

          {onOpenMappingModal && (<button_1.Button onClick={onOpenMappingModal} variant="outline" className="w-full" size="sm">
              Map Ingredients
            </button_1.Button>)}

          {nutritionData?.unmappedIngredients && nutritionData.unmappedIngredients.length === 0 && (<div className="flex items-center gap-2 text-green-600 text-sm">
              <lucide_react_1.CheckCircle className="h-4 w-4"/>
              All ingredients mapped automatically
            </div>)}
        </div>
      </card_1.CardContent>
    </card_1.Card>);
}
