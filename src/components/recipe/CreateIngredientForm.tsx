"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, X } from "lucide-react";
import { z } from "zod";

const CreateIngredientSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  servingSize: z.string().min(1, "Serving size is required"),
  calories: z.number().min(0, "Calories must be non-negative").max(1200, "Calories seem too high"),
  protein: z.number().min(0, "Protein must be non-negative").max(120, "Protein seems too high"),
  carbs: z.number().min(0, "Carbs must be non-negative").max(200, "Carbs seem too high"),
  fats: z.number().min(0, "Fats must be non-negative").max(120, "Fats seem too high"),
  fiber: z.number().min(0).max(60).optional(),
  sugar: z.number().min(0).max(150).optional(),
});

type CreateIngredientData = z.infer<typeof CreateIngredientSchema>;

interface CreateIngredientFormProps {
  ingredientName: string;
  onClose: () => void;
  onSuccess: (foodId: string) => void;
}

export function CreateIngredientForm({ ingredientName, onClose, onSuccess }: CreateIngredientFormProps) {
  const [formData, setFormData] = useState<CreateIngredientData>({
    name: ingredientName,
    servingSize: "100 g",
    calories: 0,
    protein: 0,
    carbs: 0,
    fats: 0,
    fiber: undefined,
    sugar: undefined,
  });

  const [inputValues, setInputValues] = useState({
    calories: '',
    protein: '',
    carbs: '',
    fats: '',
    fiber: '',
    sugar: '',
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleInputChange = (field: keyof CreateIngredientData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const handleNumericInputChange = (field: keyof CreateIngredientData, value: string) => {
    // Update the input value for display
    setInputValues(prev => ({ ...prev, [field]: value }));
    
    // Parse the numeric value
    const numericValue = value === '' ? (field === 'fiber' || field === 'sugar' ? undefined : 0) : parseFloat(value);
    
    // Update form data
    setFormData(prev => ({ ...prev, [field]: numericValue }));
    
    // Clear error for this field
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: "" }));
    }
  };

  const validateForm = (): boolean => {
    try {
      CreateIngredientSchema.parse(formData);
      setErrors({});
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors: Record<string, string> = {};
        error.errors.forEach(err => {
          if (err.path[0]) {
            fieldErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(fieldErrors);
      }
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Parse serving size to get grams
      const servingMatch = formData.servingSize.match(/(\d+(?:\.\d+)?)\s*g/i);
      const grams = servingMatch ? parseFloat(servingMatch[1]) : 100;

      const response = await fetch('/api/foods/quick-create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          servingLabel: formData.servingSize,
          gramsPerServing: grams,
          kcal: formData.calories,
          protein: formData.protein,
          carbs: formData.carbs,
          fat: formData.fats,
          fiber: formData.fiber,
          sugar: formData.sugar,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onSuccess(result.foodId);
        onClose();
      } else {
        setSubmitError(result.error || 'Failed to create ingredient');
      }
    } catch (error) {
      console.error('Error creating ingredient:', error);
      setSubmitError('Network error creating ingredient');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Create New Ingredient</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <Alert variant="destructive">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Ingredient Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="e.g., Low fat ricotta cheese"
                className={errors.name ? 'border-red-500' : ''}
              />
              {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="servingSize">Serving Size *</Label>
              <Input
                id="servingSize"
                value={formData.servingSize}
                onChange={(e) => handleInputChange('servingSize', e.target.value)}
                placeholder="e.g., 100 g, 1 cup, 1 tbsp"
                className={errors.servingSize ? 'border-red-500' : ''}
              />
              {errors.servingSize && <p className="text-sm text-red-500">{errors.servingSize}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="calories">Calories *</Label>
              <Input
                id="calories"
                type="number"
                value={inputValues.calories}
                onChange={(e) => handleNumericInputChange('calories', e.target.value)}
                placeholder="Enter calories"
                className={errors.calories ? 'border-red-500' : ''}
              />
              {errors.calories && <p className="text-sm text-red-500">{errors.calories}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="protein">Protein (g) *</Label>
              <Input
                id="protein"
                type="number"
                step="0.1"
                value={inputValues.protein}
                onChange={(e) => handleNumericInputChange('protein', e.target.value)}
                placeholder="Enter protein"
                className={errors.protein ? 'border-red-500' : ''}
              />
              {errors.protein && <p className="text-sm text-red-500">{errors.protein}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="carbs">Carbs (g) *</Label>
              <Input
                id="carbs"
                type="number"
                step="0.1"
                value={inputValues.carbs}
                onChange={(e) => handleNumericInputChange('carbs', e.target.value)}
                placeholder="Enter carbs"
                className={errors.carbs ? 'border-red-500' : ''}
              />
              {errors.carbs && <p className="text-sm text-red-500">{errors.carbs}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="fats">Fats (g) *</Label>
              <Input
                id="fats"
                type="number"
                step="0.1"
                value={inputValues.fats}
                onChange={(e) => handleNumericInputChange('fats', e.target.value)}
                placeholder="Enter fats"
                className={errors.fats ? 'border-red-500' : ''}
              />
              {errors.fats && <p className="text-sm text-red-500">{errors.fats}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fiber">Fiber (g) - Recommended</Label>
              <Input
                id="fiber"
                type="number"
                step="0.1"
                value={inputValues.fiber}
                onChange={(e) => handleNumericInputChange('fiber', e.target.value)}
                placeholder="Optional"
                className={errors.fiber ? 'border-red-500' : ''}
              />
              {errors.fiber && <p className="text-sm text-red-500">{errors.fiber}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="sugar">Sugar (g) - Recommended</Label>
              <Input
                id="sugar"
                type="number"
                step="0.1"
                value={inputValues.sugar}
                onChange={(e) => handleNumericInputChange('sugar', e.target.value)}
                placeholder="Optional"
                className={errors.sugar ? 'border-red-500' : ''}
              />
              {errors.sugar && <p className="text-sm text-red-500">{errors.sugar}</p>}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="flex-1">
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Ingredient'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
