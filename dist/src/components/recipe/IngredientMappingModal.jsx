"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngredientMappingModal = IngredientMappingModal;
const react_1 = require("react");
const dialog_1 = require("@/components/ui/dialog");
const button_1 = require("@/components/ui/button");
const input_1 = require("@/components/ui/input");
const card_1 = require("@/components/ui/card");
const badge_1 = require("@/components/ui/badge");
const alert_1 = require("@/components/ui/alert");
const tooltip_1 = require("@/components/ui/tooltip");
const lucide_react_1 = require("lucide-react");
const ingredient_line_1 = require("@/lib/parse/ingredient-line");
const amount_grams_adapter_1 = require("@/lib/nutrition/amount-grams-adapter");
const IngredientMappingCard_1 = require("./IngredientMappingCard");
function IngredientMappingModal({ isOpen, onClose, recipeId, onMappingComplete }) {
    const [ingredients, setIngredients] = (0, react_1.useState)([]);
    const [searchQueries, setSearchQueries] = (0, react_1.useState)({});
    const [searchResults, setSearchResults] = (0, react_1.useState)({});
    const [selectedFoods, setSelectedFoods] = (0, react_1.useState)({});
    const [isLoading, setIsLoading] = (0, react_1.useState)(false);
    const [isMapping, setIsMapping] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [searchStates, setSearchStates] = (0, react_1.useState)({});
    const [ingredientSuccess, setIngredientSuccess] = (0, react_1.useState)({});
    const [mappedFoodIds, setMappedFoodIds] = (0, react_1.useState)({});
    (0, react_1.useEffect)(() => {
        if (isOpen) {
            loadIngredients();
        }
    }, [isOpen, recipeId]);
    // Initialize per-ingredient UI state and ensure mapped cards are visible
    (0, react_1.useEffect)(() => {
        if (ingredients.length === 0)
            return;
        ingredients.forEach((ingredient) => {
            // Initialize input value
            if (!ingredient.currentMapping) {
                setSearchQueries(prev => ({ ...prev, [ingredient.id]: ingredient.name }));
            }
            else {
                // Persist mapped metadata
                setSelectedFoods(prev => ({ ...prev, [ingredient.id]: ingredient.currentMapping.foodId }));
                setMappedFoodIds(prev => ({ ...prev, [ingredient.id]: ingredient.currentMapping.foodId }));
                setIngredientSuccess(prev => ({ ...prev, [ingredient.id]: true }));
                // Ensure the mapped card is visible by fetching the mapped food by ID
                (async () => {
                    try {
                        const res = await fetch(`/api/foods/${ingredient.currentMapping.foodId}`);
                        const data = await res.json();
                        if (data?.success && data?.data) {
                            const mappedFood = {
                                ...data.data,
                                confidence: ingredient.currentMapping.confidence ?? 1,
                                servingOptions: data.data.servingOptions || [],
                            };
                            setSearchResults(prev => ({ ...prev, [ingredient.id]: [mappedFood] }));
                            setSearchStates(prev => ({ ...prev, [ingredient.id]: '' }));
                            // Also reflect the mapped food name in the input for clarity
                            setSearchQueries(prev => ({ ...prev, [ingredient.id]: data.data.name }));
                        }
                    }
                    catch (e) {
                        // Quietly ignore; user can still search manually
                    }
                })();
            }
        });
    }, [ingredients]);
    const loadIngredients = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await fetch(`/api/recipes/${recipeId}/ingredients`);
            const result = await response.json();
            if (result.success) {
                setIngredients(result.data || []);
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
    const searchFoods = async (ingredientId, query) => {
        if (query.length < 2) {
            setSearchResults(prev => ({ ...prev, [ingredientId]: [] }));
            setSearchStates(prev => ({ ...prev, [ingredientId]: '' }));
            return;
        }
        // Debounce search to prevent too many API calls
        const timeoutId = setTimeout(async () => {
            await performSearch(ingredientId, query);
        }, 300);
        return () => clearTimeout(timeoutId);
    };
    const performSearch = async (ingredientId, query) => {
        console.log(`performSearch called for ${ingredientId} with query: ${query}`);
        // Set initial search state
        setSearchStates(prev => ({ ...prev, [ingredientId]: 'Searching local...' }));
        setSearchResults(prev => ({ ...prev, [ingredientId]: [] }));
        try {
            // Search local database first
            const localResponse = await fetch(`/api/foods/search?s=${encodeURIComponent(query)}`);
            const localResult = await localResponse.json();
            let allResults = [];
            if (localResult.success && localResult.data.length > 0) {
                allResults = [...localResult.data];
                setSearchResults(prev => ({ ...prev, [ingredientId]: allResults }));
                console.log(`Search results for ${ingredientId} (${query}):`, allResults.length, 'results');
            }
            else {
                // If no results found, try to find the mapped food by ID
                const ingredient = ingredients.find(ing => ing.id === ingredientId);
                if (ingredient?.currentMapping) {
                    console.log(`No search results for ${query}, trying to find mapped food by ID: ${ingredient.currentMapping.foodId}`);
                    // Try to fetch the specific food by ID
                    try {
                        const foodResponse = await fetch(`/api/foods/${ingredient.currentMapping.foodId}`);
                        const foodResult = await foodResponse.json();
                        if (foodResult.success && foodResult.data) {
                            // Create a mock search result with the mapped food
                            const mockFood = {
                                ...foodResult.data,
                                confidence: 1.0, // High confidence for mapped foods
                                servingOptions: foodResult.data.servingOptions || []
                            };
                            setSearchResults(prev => ({ ...prev, [ingredientId]: [mockFood] }));
                            console.log(`Found mapped food by ID: ${mockFood.name}`);
                        }
                    }
                    catch (err) {
                        console.error('Failed to fetch mapped food by ID:', err);
                    }
                }
            }
            // Update state to show USDA search
            setSearchStates(prev => ({ ...prev, [ingredientId]: 'Searching USDA...' }));
            // TODO: Add USDA search here when implemented
            // const usdaResults = await searchUSDAFoods(query);
            // if (usdaResults.length > 0) {
            //   allResults = [...allResults, ...usdaResults];
            //   setSearchResults(prev => ({ ...prev, [ingredientId]: allResults }));
            // }
            // Update state to show OpenFoodFacts search
            setSearchStates(prev => ({ ...prev, [ingredientId]: 'Searching OpenFoodFacts...' }));
            // TODO: Add OpenFoodFacts search here when implemented
            // const offResults = await searchOpenFoodFacts(query);
            // if (offResults.length > 0) {
            //   allResults = [...allResults, ...offResults];
            //   setSearchResults(prev => ({ ...prev, [ingredientId]: allResults }));
            // }
            // Final state update
            if (allResults.length === 0) {
                setSearchStates(prev => ({ ...prev, [ingredientId]: 'No results—try a simpler term' }));
            }
            else {
                setSearchStates(prev => ({ ...prev, [ingredientId]: '' }));
                // Auto-select exact matches (case-insensitive and with common variations)
                const exactMatch = allResults.find((food) => {
                    const foodName = food.name.toLowerCase();
                    const queryLower = query.toLowerCase();
                    // Direct match
                    if (foodName === queryLower)
                        return true;
                    // Handle common variations
                    if (queryLower === 'greek yogurt' && foodName.includes('greek') && foodName.includes('yogurt'))
                        return true;
                    if (queryLower === 'almonds' && foodName === 'almonds')
                        return true;
                    if (queryLower === 'banana' && foodName === 'banana')
                        return true;
                    if (queryLower === 'oats' && foodName === 'oats')
                        return true;
                    return false;
                });
                if (exactMatch && !selectedFoods[ingredientId]) {
                    selectFood(ingredientId, exactMatch.id);
                }
            }
        }
        catch (err) {
            console.error('Search error:', err);
            setSearchStates(prev => ({ ...prev, [ingredientId]: 'Search failed—try again' }));
        }
    };
    const handleSearchChange = (ingredientId, query) => {
        setSearchQueries(prev => ({ ...prev, [ingredientId]: query }));
        // Clear search results for other ingredients when searching, but preserve automapped results
        setSearchResults(prev => {
            const newResults = { ...prev };
            Object.keys(newResults).forEach(id => {
                if (id !== ingredientId) {
                    // Don't clear results for automapped ingredients
                    const ingredient = ingredients.find(ing => ing.id === id);
                    if (!ingredient?.currentMapping) {
                        newResults[id] = [];
                    }
                }
            });
            return newResults;
        });
        searchFoods(ingredientId, query);
    };
    const selectFood = (ingredientId, foodId) => {
        setSelectedFoods(prev => ({ ...prev, [ingredientId]: foodId }));
    };
    const computeNutrition = async () => {
        try {
            const response = await fetch(`/api/recipes/${recipeId}/compute-nutrition`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ goal: 'general' }),
            });
            if (!response.ok) {
                console.error('Failed to compute nutrition');
                return;
            }
            const result = await response.json();
            if (result.success) {
                console.log('✅ Nutrition computed successfully');
                // You could emit an event here to update the nutrition sidebar
                // or call a callback to refresh the parent component
            }
        }
        catch (err) {
            console.error('Nutrition computation error:', err);
        }
    };
    const mapIngredient = async (opts, ingredientId) => {
        try {
            const response = await fetch('/api/foods/map', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ingredientId,
                    foodId: opts.foodId,
                    useOnce: opts.useOnce,
                    confidence: opts.confidence
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to map ingredient');
            }
            // Update the ingredient's current mapping in the UI
            const ingredient = ingredients.find(ing => ing.id === ingredientId);
            if (ingredient) {
                const food = searchResults[ingredientId]?.find(f => f.id === opts.foodId);
                if (food) {
                    // Update the ingredient's current mapping
                    setIngredients(prev => prev.map(ing => ing.id === ingredientId
                        ? {
                            ...ing,
                            currentMapping: {
                                foodId: food.id,
                                foodName: food.name,
                                foodBrand: food.brand ?? undefined,
                                confidence: opts.confidence
                            }
                        }
                        : ing));
                    // Show success message for this ingredient
                    setIngredientSuccess(prev => ({ ...prev, [ingredientId]: true }));
                    setError(null);
                    // Track which food is mapped for this ingredient
                    setMappedFoodIds(prev => ({ ...prev, [ingredientId]: opts.foodId }));
                }
            }
            return true;
        }
        catch (err) {
            console.error('Mapping error:', err);
            setError(err instanceof Error ? err.message : 'Failed to map ingredient');
            return false;
        }
    };
    const mapAllIngredients = async () => {
        setIsMapping(true);
        setError(null);
        try {
            // Only map ingredients that have new selections (not already mapped)
            const newMappings = Object.entries(selectedFoods).filter(([ingredientId, foodId]) => {
                const ingredient = ingredients.find(ing => ing.id === ingredientId);
                return ingredient && !ingredient.currentMapping;
            });
            if (newMappings.length === 0) {
                // All ingredients are already mapped, just close
                onMappingComplete?.();
                onClose();
                return;
            }
            const mappingPromises = newMappings.map(([ingredientId, foodId]) => fetch('/api/foods/map', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ingredientId, foodId }),
            }));
            const results = await Promise.all(mappingPromises);
            const failedMappings = results.filter(result => !result.ok);
            if (failedMappings.length > 0) {
                setError('Some ingredients failed to map. Please try again.');
                return;
            }
            onMappingComplete?.();
            onClose();
        }
        catch (err) {
            console.error('Mapping error:', err);
            setError('Network error mapping ingredients');
        }
        finally {
            setIsMapping(false);
        }
    };
    const mappedCount = ingredients.filter(ingredient => selectedFoods[ingredient.id] || ingredient.currentMapping).length;
    const totalCount = ingredients.length;
    const allMapped = mappedCount === totalCount && totalCount > 0;
    return (<tooltip_1.TooltipProvider>
      <dialog_1.Dialog open={isOpen} onOpenChange={onClose}>
        <dialog_1.DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <dialog_1.DialogHeader>
          <dialog_1.DialogTitle>Map Ingredients to Nutrition Data</dialog_1.DialogTitle>
        </dialog_1.DialogHeader>

        {error && (<alert_1.Alert variant="destructive">
            <alert_1.AlertDescription>{error}</alert_1.AlertDescription>
          </alert_1.Alert>)}


        {isLoading ? (<div className="flex items-center justify-center py-8">
            <lucide_react_1.Loader2 className="h-6 w-6 animate-spin"/>
            <span className="ml-2">Loading ingredients...</span>
          </div>) : ingredients.length === 0 ? (<div className="text-center py-8">
            <p className="text-muted-foreground">No ingredients found.</p>
          </div>) : (<div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Map each ingredient to a food item for accurate nutrition calculation
              </p>
              <badge_1.Badge variant="outline">
                {mappedCount} of {totalCount} mapped
              </badge_1.Badge>
            </div>
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                💡 <strong>Tip:</strong> Try removing brand words (e.g., 'power cakes' instead of 'kodiak power cakes')
              </p>
            </div>

            <div className="space-y-4">
              {ingredients.map((ingredient) => (<card_1.Card key={ingredient.id}>
                  <card_1.CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{ingredient.name}</span>
                        <badge_1.Badge variant="outline">
                          {`${ingredient.qty} ${ingredient.unit}`}
                        </badge_1.Badge>
                        {ingredient.currentMapping && (<div className="flex items-center gap-2">
                            <badge_1.Badge variant="secondary" className="bg-blue-100 text-blue-800">
                              Currently: {ingredient.currentMapping.foodName}
                              {ingredient.currentMapping.foodBrand && ` (${ingredient.currentMapping.foodBrand})`}
                            </badge_1.Badge>
                            {ingredientSuccess[ingredient.id] && (<badge_1.Badge variant="default" className="bg-green-600">
                                <lucide_react_1.Check className="h-3 w-3 mr-1"/>
                                Mapped
                              </badge_1.Badge>)}
                          </div>)}
                      </div>

                      <div className="space-y-2">
                        <div className="relative">
                          <lucide_react_1.Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
                          <input_1.Input placeholder="Search for food item..." value={searchQueries[ingredient.id] || ''} onChange={(e) => handleSearchChange(ingredient.id, e.target.value)} className="pl-10"/>
                        </div>

                        {/* Search State Display */}
                        {searchStates[ingredient.id] && (<div className="text-sm text-muted-foreground py-2">
                            {searchStates[ingredient.id]}
                          </div>)}

                        {/* Search Results */}
                        {searchResults[ingredient.id] && searchResults[ingredient.id].length > 0 && (<div className="space-y-2 max-h-64 overflow-y-auto">
                            {searchResults[ingredient.id].map((food) => {
                        // Parse the ingredient line to get structured data
                        const parsed = (0, ingredient_line_1.parseIngredientLine)(`${ingredient.qty} ${ingredient.unit} ${ingredient.name}`);
                        // Resolve grams using the new adapter
                        const gramsResolved = (0, amount_grams_adapter_1.resolveGramsAdapter)({
                            parsed: parsed ?? undefined,
                            densityGml: food.densityGml,
                            servingOptions: food.servingOptions
                        });
                        // Check if we used fallback serving (first serving option)
                        const usedFallbackServing = parsed && parsed.unit &&
                            !food.servingOptions.find(opt => opt.label.toLowerCase().includes(parsed.unit.toLowerCase())) &&
                            food.servingOptions.length > 0;
                        return (<IngredientMappingCard_1.IngredientMappingCard key={food.id} ingredientName={ingredient.name} parsed={parsed ?? undefined} candidate={food} onMap={(opts) => mapIngredient(opts, ingredient.id)} gramsResolved={gramsResolved} usedFallbackServing={usedFallbackServing ? true : undefined} isMapped={mappedFoodIds[ingredient.id] === food.id}/>);
                    })}
                          </div>)}
                      </div>
                    </div>
                  </card_1.CardContent>
                </card_1.Card>))}
            </div>

            <div className="flex gap-3">
              <button_1.Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </button_1.Button>
              <button_1.Button onClick={mapAllIngredients} disabled={!allMapped || isMapping} className="flex-1">
                {isMapping ? (<>
                    <lucide_react_1.Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                    Mapping...
                  </>) : (<>
                    <lucide_react_1.Check className="h-4 w-4 mr-2"/>
                    Map All Ingredients
                  </>)}
              </button_1.Button>
            </div>
          </div>)}
      </dialog_1.DialogContent>
    </dialog_1.Dialog>
    </tooltip_1.TooltipProvider>);
}
