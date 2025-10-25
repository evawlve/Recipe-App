"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChipSelect } from "./TagChipSelect";

interface MealTypeStepProps {
  selectedMealType: string[];
  onMealTypeChange: (selectedTags: string[]) => void;
  error?: string;
}

export function MealTypeStep({
  selectedMealType,
  onMealTypeChange,
  error
}: MealTypeStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Meal Type *</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            What type of meal is this recipe for?
          </p>
          <TagChipSelect
            namespace="MEAL_TYPE"
            selectedTags={selectedMealType}
            onSelectionChange={onMealTypeChange}
            multiple={false}
            required={true}
          />
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
