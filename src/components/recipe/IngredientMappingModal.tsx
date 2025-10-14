"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Search, Check, X } from "lucide-react";

interface Food {
  id: string;
  name: string;
  brand: string | null;
  source: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
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

  useEffect(() => {
    if (isOpen) {
      loadIngredients();
    }
  }, [isOpen, recipeId]);

  // Auto-search for each ingredient when they load
  useEffect(() => {
    if (ingredients.length > 0) {
      ingredients.forEach(ingredient => {
        // Auto-search for each ingredient
        const searchTerm = ingredient.currentMapping?.foodName || ingredient.name;
        handleSearchChange(ingredient.id, searchTerm);
        
        // Pre-select current mapping if it exists
        if (ingredient.currentMapping) {
          setSelectedFoods(prev => ({
            ...prev,
            [ingredient.id]: ingredient.currentMapping!.foodId
          }));
        }
      });
    }
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
    searchFoods(ingredientId, query);
  };

  const selectFood = (ingredientId: string, foodId: string) => {
    setSelectedFoods(prev => ({ ...prev, [ingredientId]: foodId }));
  };

  const mapAllIngredients = async () => {
    setIsMapping(true);
    setError(null);
    
    try {
      const mappingPromises = Object.entries(selectedFoods).map(([ingredientId, foodId]) =>
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

      onMappingComplete?.();
      onClose();
    } catch (err) {
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
            
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-sm text-blue-800">
                💡 <strong>Tip:</strong> Try removing brand words (e.g., 'power cakes' instead of 'kodiak power cakes')
              </p>
            </div>

            <div className="space-y-4">
              {ingredients.map((ingredient) => (
                <Card key={ingredient.id}>
                  <CardContent className="p-4">
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{ingredient.name}</span>
                        <Badge variant="outline">
                          {`${ingredient.qty} ${ingredient.unit}`}
                        </Badge>
                        {ingredient.currentMapping && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                            Currently: {ingredient.currentMapping.foodName}
                            {ingredient.currentMapping.foodBrand && ` (${ingredient.currentMapping.foodBrand})`}
                          </Badge>
                        )}
                        {selectedFoods[ingredient.id] && (
                          <Badge variant="default" className="bg-green-600">
                            <Check className="h-3 w-3 mr-1" />
                            New Selection
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input
                            placeholder="Search for food item..."
                            value={searchQueries[ingredient.id] || ingredient.currentMapping?.foodName || ''}
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

                        {/* Search Results */}
                        {searchResults[ingredient.id] && searchResults[ingredient.id].length > 0 && (
                          <div className="space-y-2 max-h-32 overflow-y-auto">
                            {searchResults[ingredient.id].map((food) => (
                              <Card
                                key={food.id}
                                className={`cursor-pointer transition-colors ${
                                  selectedFoods[ingredient.id] === food.id
                                    ? 'ring-2 ring-primary bg-primary/5'
                                    : 'hover:bg-muted/50'
                                }`}
                                onClick={() => selectFood(ingredient.id, food.id)}
                              >
                                <CardContent className="p-3">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-medium">
                                        {food.name}
                                        {food.brand && (
                                          <span className="text-muted-foreground ml-1">
                                            ({food.brand})
                                          </span>
                                        )}
                                      </div>
                                      <div className="text-sm text-muted-foreground">
                                        {food.calories} cal, {food.proteinG}g protein, {food.carbsG}g carbs, {food.fatG}g fat
                                      </div>
                                    </div>
                                    {selectedFoods[ingredient.id] === food.id && (
                                      <Check className="h-4 w-4 text-primary" />
                                    )}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
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
  );
}
