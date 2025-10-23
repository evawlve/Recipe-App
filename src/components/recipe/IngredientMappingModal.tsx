"use client";

import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Search, Check, X, Info, Plus, Trash2 } from "lucide-react";
import { gramsForMeasure, calculatePerServingCalories, extractCategoryHint } from "@/lib/nutrition/serving";
import { normalizeUnit, toGramsByUnit } from "@/lib/nutrition/units";
import { scalePer100g } from "@/lib/nutrition/scale";
import { resolveGramsForAmount } from "@/lib/nutrition/amount-grams";
import { parseIngredientLine } from "@/lib/parse/ingredient-line";
import { resolveGramsAdapter } from "@/lib/nutrition/amount-grams-adapter";
import { IngredientMappingCard } from "./IngredientMappingCard";
import { CreateIngredientForm } from "./CreateIngredientForm";

interface Food {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  verification: string;
  confidence: number;
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  fiber100: number;
  sugar100: number;
  densityGml: number | null;
  categoryId: string | null;
  servingOptions: Array<{ label: string; grams: number }>;
}

interface Ingredient {
  id: string;
  name: string;
  qty: number;
  unit: string;
  currentMapping?: {
    foodId: string;
    foodName: string;
    foodBrand?: string;
    confidence?: number;
  } | null;
}


interface IngredientMappingModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipeId: string;
  onMappingComplete?: () => void;
}

export function IngredientMappingModal({ 
  isOpen, 
  onClose, 
  recipeId, 
  onMappingComplete 
}: IngredientMappingModalProps) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [searchQueries, setSearchQueries] = useState<Record<string, string>>({});
  const [searchResults, setSearchResults] = useState<Record<string, Food[]>>({});
  const [selectedFoods, setSelectedFoods] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchStates, setSearchStates] = useState<Record<string, string>>({});
  const [ingredientSuccess, setIngredientSuccess] = useState<Record<string, boolean>>({});
  const [mappedFoodIds, setMappedFoodIds] = useState<Record<string, string>>({});
  const [showCreateIngredient, setShowCreateIngredient] = useState<Record<string, boolean>>({});
  const [deletableFoods, setDeletableFoods] = useState<Set<string>>(new Set());
  const searchTimeouts = useRef<Record<string, NodeJS.Timeout>>({});

  useEffect(() => {
    if (isOpen) {
      loadIngredients();
    } else {
      // Clear state when modal closes
      setSelectedFoods({});
      setSearchResults({});
      setSearchQueries({});
      setSearchStates({});
      setIngredientSuccess({});
      setMappedFoodIds({});
      setShowCreateIngredient({});
      setDeletableFoods(new Set());
      setError(null);
    }
  }, [isOpen, recipeId]);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(searchTimeouts.current).forEach(timeout => {
        clearTimeout(timeout);
      });
    };
  }, []);

  // Initialize per-ingredient UI state and ensure mapped cards are visible
  useEffect(() => {
    if (ingredients.length === 0) return;

    ingredients.forEach((ingredient) => {
      // Initialize input value
      if (!ingredient.currentMapping) {
        setSearchQueries(prev => ({ ...prev, [ingredient.id]: ingredient.name }));
      } else {
        // Persist mapped metadata
        setSelectedFoods(prev => ({ ...prev, [ingredient.id]: ingredient.currentMapping!.foodId }));
        setMappedFoodIds(prev => ({ ...prev, [ingredient.id]: ingredient.currentMapping!.foodId }));
        setIngredientSuccess(prev => ({ ...prev, [ingredient.id]: true }));

        // Ensure the mapped card is visible by fetching the mapped food by ID
        (async () => {
          try {
            const res = await fetch(`/api/foods/${ingredient.currentMapping!.foodId}`);
            const data = await res.json();
            if (data?.success && data?.data) {
              const mappedFood = {
                ...data.data,
                confidence: ingredient.currentMapping!.confidence ?? 1,
                servingOptions: data.data.servingOptions || [],
              } as Food;
              setSearchResults(prev => ({ ...prev, [ingredient.id]: [mappedFood] }));
              setSearchStates(prev => ({ ...prev, [ingredient.id]: '' }));
              // Also reflect the mapped food name in the input for clarity
              setSearchQueries(prev => ({ ...prev, [ingredient.id]: data.data.name }));
            }
          } catch (e) {
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
      } else {
        setError(result.error || 'Failed to load ingredients');
      }
    } catch (err) {
      setError('Network error loading ingredients');
    } finally {
      setIsLoading(false);
    }
  };

  const searchFoods = async (ingredientId: string, query: string) => {
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

  const performSearch = async (ingredientId: string, query: string) => {
    console.log(`performSearch called for ${ingredientId} with query: ${query}`);
    // Set initial search state
    setSearchStates(prev => ({ ...prev, [ingredientId]: 'Searching local...' }));
    setSearchResults(prev => ({ ...prev, [ingredientId]: [] }));

    try {
      // Search local database first
      const localResponse = await fetch(`/api/foods/search?s=${encodeURIComponent(query)}`);
      const localResult = await localResponse.json();
      
      let allResults: Food[] = [];
      
      if (localResult.success && localResult.data.length > 0) {
        allResults = [...localResult.data];
        setSearchResults(prev => ({ ...prev, [ingredientId]: allResults }));
        
        // Mark community foods as deletable
        const communityFoods = allResults.filter(food => food.source === 'community');
        if (communityFoods.length > 0) {
          setDeletableFoods(prev => {
            const newSet = new Set(prev);
            communityFoods.forEach(food => newSet.add(food.id));
            return newSet;
          });
        }
        
        console.log(`Search results for ${ingredientId} (${query}):`, allResults.length, 'results');
      } else {
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
          } catch (err) {
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
      } else {
        setSearchStates(prev => ({ ...prev, [ingredientId]: '' }));
        
        // Auto-select exact matches (case-insensitive and with common variations)
        const exactMatch = allResults.find((food: any) => {
          const foodName = food.name.toLowerCase();
          const queryLower = query.toLowerCase();
          
          // Direct match
          if (foodName === queryLower) return true;
          
          // Handle common variations
          if (queryLower === 'greek yogurt' && foodName.includes('greek') && foodName.includes('yogurt')) return true;
          if (queryLower === 'almonds' && foodName === 'almonds') return true;
          if (queryLower === 'banana' && foodName === 'banana') return true;
          if (queryLower === 'oats' && foodName === 'oats') return true;
          
          return false;
        });
        
        if (exactMatch && !selectedFoods[ingredientId]) {
          selectFood(ingredientId, exactMatch.id);
        }
      }
    } catch (err) {
      console.error('Search error:', err);
      setSearchStates(prev => ({ ...prev, [ingredientId]: 'Search failed—try again' }));
    }
  };

  const handleSearchChange = (ingredientId: string, query: string) => {
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
    
    // Clear any existing timeout for this ingredient
    if (searchTimeouts.current[ingredientId]) {
      clearTimeout(searchTimeouts.current[ingredientId]);
    }
    
    // Set up new debounced search
    if (query.length >= 2) {
      const timeoutId = setTimeout(async () => {
        await performSearch(ingredientId, query);
        delete searchTimeouts.current[ingredientId];
      }, 300);
      searchTimeouts.current[ingredientId] = timeoutId;
    } else {
      setSearchResults(prev => ({ ...prev, [ingredientId]: [] }));
      setSearchStates(prev => ({ ...prev, [ingredientId]: '' }));
    }
  };

  const selectFood = (ingredientId: string, foodId: string) => {
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
    } catch (err) {
      console.error('Nutrition computation error:', err);
    }
  };

  const mapIngredient = async (opts: { foodId: string; servingGrams: number; useOnce: boolean; confidence: number }, ingredientId: string) => {
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
          setIngredients(prev => prev.map(ing => 
            ing.id === ingredientId 
              ? { 
                  ...ing, 
                  currentMapping: { 
                    foodId: food.id, 
                    foodName: food.name, 
                    foodBrand: food.brand ?? undefined,
                    confidence: opts.confidence 
                  } 
                }
              : ing
          ));
          
          // Show success message for this ingredient
          setIngredientSuccess(prev => ({ ...prev, [ingredientId]: true }));
          setError(null);
          
          // Track which food is mapped for this ingredient
          setMappedFoodIds(prev => ({ ...prev, [ingredientId]: opts.foodId }));
        }
      }

      return true;
    } catch (err) {
      console.error('Mapping error:', err);
      setError(err instanceof Error ? err.message : 'Failed to map ingredient');
      return false;
    }
  };

  const handleCreateIngredientSuccess = async (ingredientId: string, foodId: string) => {
    try {
      // Auto-map the newly created ingredient
      const success = await mapIngredient(
        { 
          foodId, 
          servingGrams: 100, // Default serving size
          useOnce: false, 
          confidence: 1.0 
        }, 
        ingredientId
      );

      if (success) {
        // Close the create ingredient form
        setShowCreateIngredient(prev => ({ ...prev, [ingredientId]: false }));
        
        // Mark the newly created food as deletable
        setDeletableFoods(prev => new Set([...prev, foodId]));
        
        // Refresh the search results to show the newly created ingredient
        const ingredient = ingredients.find(ing => ing.id === ingredientId);
        if (ingredient) {
          await performSearch(ingredientId, ingredient.name);
        }
      }
    } catch (error) {
      console.error('Error auto-mapping created ingredient:', error);
      setError('Failed to map the newly created ingredient');
    }
  };

  const handleDeleteFood = async (foodId: string, ingredientId: string) => {
    if (!confirm('Are you sure you want to delete this ingredient? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/foods/${foodId}?recipeId=${recipeId}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        // Remove from deletable foods
        setDeletableFoods(prev => {
          const newSet = new Set(prev);
          newSet.delete(foodId);
          return newSet;
        });

        // Remove from search results
        setSearchResults(prev => ({
          ...prev,
          [ingredientId]: prev[ingredientId]?.filter(food => food.id !== foodId) || []
        }));

        // Clear any mapping if this food was selected
        if (selectedFoods[ingredientId] === foodId) {
          setSelectedFoods(prev => {
            const newSelected = { ...prev };
            delete newSelected[ingredientId];
            return newSelected;
          });
        }

        // Also clear any current mapping if it was to the deleted food
        setIngredients(prev => prev.map(ing => 
          ing.id === ingredientId && ing.currentMapping?.foodId === foodId
            ? { ...ing, currentMapping: null }
            : ing
        ));

        setError(null);
      } else {
        setError(result.error || 'Failed to delete ingredient');
      }
    } catch (error) {
      console.error('Error deleting food:', error);
      setError('Network error deleting ingredient');
    }
  };

  const mapAllIngredients = async () => {
    setIsMapping(true);
    setError(null);
    
    try {
      // Map all ingredients that have selections (including re-mappings)
      const mappingsToProcess = Object.entries(selectedFoods).filter(([ingredientId, foodId]) => {
        const ingredient = ingredients.find(ing => ing.id === ingredientId);
        // Include if ingredient exists and has a different mapping than current
        return ingredient && (
          !ingredient.currentMapping || 
          ingredient.currentMapping.foodId !== foodId
        );
      });

      if (mappingsToProcess.length === 0) {
        // No new mappings to process, just close
        onMappingComplete?.();
        onClose();
        return;
      }

      const mappingPromises = mappingsToProcess.map(([ingredientId, foodId]) =>
        fetch('/api/foods/map', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ingredientId, foodId }),
        })
      );

      const results = await Promise.all(mappingPromises);
      const failedMappings = results.filter(result => !result.ok);
      
      if (failedMappings.length > 0) {
        setError('Some ingredients failed to map. Please try again.');
        return;
      }

      // Update the ingredients state to reflect the new mappings
      const updatedIngredients = ingredients.map(ingredient => {
        const selectedFoodId = selectedFoods[ingredient.id];
        if (selectedFoodId) {
          const selectedFood = searchResults[ingredient.id]?.find(food => food.id === selectedFoodId);
          if (selectedFood) {
            return {
              ...ingredient,
              currentMapping: {
                foodId: selectedFood.id,
                foodName: selectedFood.name,
                foodBrand: selectedFood.brand ?? undefined,
                confidence: selectedFood.confidence
              }
            };
          }
        }
        return ingredient;
      });

      setIngredients(updatedIngredients);

      // Reload ingredients from database to get the latest mappings
      await loadIngredients();

      // Recompute nutrition after mappings are updated
      try {
        const nutritionResponse = await fetch(`/api/recipes/${recipeId}/compute-nutrition`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ goal: 'general' }),
        });

        if (nutritionResponse.ok) {
          console.log('✅ Nutrition recomputed successfully');
        } else {
          console.warn('⚠️ Failed to recompute nutrition');
        }
      } catch (error) {
        console.warn('⚠️ Error recomputing nutrition:', error);
        // Don't fail the mapping process if nutrition computation fails
      }

      onMappingComplete?.();
      onClose();
    } catch (err) {
      console.error('Mapping error:', err);
      setError('Network error mapping ingredients');
    } finally {
      setIsMapping(false);
    }
  };


  const mappedCount = ingredients.filter(ingredient => 
    selectedFoods[ingredient.id] || ingredient.currentMapping
  ).length;
  const totalCount = ingredients.length;
  const allMapped = mappedCount === totalCount && totalCount > 0;

  return (
    <TooltipProvider>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Map Ingredients to Nutrition Data</DialogTitle>
        </DialogHeader>


        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}


        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="ml-2">Loading ingredients...</span>
          </div>
        ) : ingredients.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">No ingredients found.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Map each ingredient to a food item for accurate nutrition calculation
              </p>
              <Badge variant="outline">
                {mappedCount} of {totalCount} mapped
              </Badge>
            </div>
            

            <div className="space-y-4">
              {ingredients.map((ingredient) => (
                <Card key={ingredient.id}>
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{ingredient.name}</span>
                          <Badge variant="outline">
                            {`${ingredient.qty} ${ingredient.unit}`}
                          </Badge>
                          {ingredient.currentMapping && (
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                                Currently: {ingredient.currentMapping.foodName}
                                {ingredient.currentMapping.foodBrand && ` (${ingredient.currentMapping.foodBrand})`}
                              </Badge>
                              {ingredientSuccess[ingredient.id] && (
                                <Badge variant="default" className="bg-green-600">
                                  <Check className="h-3 w-3 mr-1" />
                                  Mapped
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setShowCreateIngredient(prev => ({ ...prev, [ingredient.id]: true }))}
                          className="flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          Create new ingredient
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search for food item..."
                            value={searchQueries[ingredient.id] || ''}
                            onChange={(e) => handleSearchChange(ingredient.id, e.target.value)}
                            className="pl-10"
                          />
                        </div>

                        {/* Search State Display */}
                        {searchStates[ingredient.id] && (
                          <div className="text-sm text-muted-foreground py-2">
                            {searchStates[ingredient.id]}
                          </div>
                        )}


                        {/* Create Ingredient Form */}
                        {showCreateIngredient[ingredient.id] && (
                          <div className="mt-4">
                            <CreateIngredientForm
                              ingredientName={ingredient.name}
                              onClose={() => setShowCreateIngredient(prev => ({ ...prev, [ingredient.id]: false }))}
                              onSuccess={(foodId) => handleCreateIngredientSuccess(ingredient.id, foodId)}
                            />
                          </div>
                        )}

                        {/* Search Results */}
                        {searchResults[ingredient.id] && searchResults[ingredient.id].length > 0 && (
                          <div className="space-y-2 max-h-64 overflow-y-auto">
                            {searchResults[ingredient.id].map((food) => {
                              // Parse the ingredient line to get structured data
                              const parsed = parseIngredientLine(`${ingredient.qty} ${ingredient.unit} ${ingredient.name}`);
                              
                              // Resolve grams using the new adapter
                              const gramsResolved = resolveGramsAdapter({
                                parsed: parsed ?? undefined,
                                densityGml: food.densityGml,
                                servingOptions: food.servingOptions
                              });
                              
                              // Check if we used fallback serving (first serving option)
                              const usedFallbackServing = parsed && parsed.unit && 
                                !food.servingOptions.find(opt => 
                                  opt.label.toLowerCase().includes(parsed.unit!.toLowerCase())
                                ) && 
                                food.servingOptions.length > 0;
                              
                              return (
                                <IngredientMappingCard
                                  key={food.id}
                                  ingredientName={ingredient.name}
                                  parsed={parsed ?? undefined}
                                  candidate={food}
                                  onMap={(opts) => mapIngredient(opts, ingredient.id)}
                                  gramsResolved={gramsResolved}
                                  usedFallbackServing={usedFallbackServing ? true : undefined}
                                  isMapped={mappedFoodIds[ingredient.id] === food.id}
                                  canDelete={deletableFoods.has(food.id)}
                                  onDelete={() => handleDeleteFood(food.id, ingredient.id)}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={onClose} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={mapAllIngredients}
                disabled={!allMapped || isMapping}
                className="flex-1"
              >
                {isMapping ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Mapping...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Map All Ingredients
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
    </TooltipProvider>
  );
}
