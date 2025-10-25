"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TagChipSelect } from "./TagChipSelect";

interface OptionalTaxonomyProps {
  selectedCuisine: string[];
  onCuisineChange: (selectedTags: string[]) => void;
  selectedMethod: string[];
  onMethodChange: (selectedTags: string[]) => void;
  selectedDiet: string[];
  onDietChange: (selectedTags: string[]) => void;
}

export function OptionalTaxonomy({
  selectedCuisine,
  onCuisineChange,
  selectedMethod,
  onMethodChange,
  selectedDiet,
  onDietChange
}: OptionalTaxonomyProps) {
  return (
    <div className="space-y-6">
      {/* Cuisine */}
      <Card>
        <CardHeader>
          <CardTitle>Cuisine</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              What cuisine does this recipe belong to?
            </p>
            <TagChipSelect
              namespace="CUISINE"
              selectedTags={selectedCuisine}
              onSelectionChange={onCuisineChange}
              multiple={true}
              required={false}
            />
          </div>
        </CardContent>
      </Card>

      {/* Cooking Method */}
      <Card>
        <CardHeader>
          <CardTitle>Cooking Method</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              How is this recipe cooked? (select all that apply)
            </p>
            <TagChipSelect
              namespace="METHOD"
              selectedTags={selectedMethod}
              onSelectionChange={onMethodChange}
              multiple={true}
              required={false}
            />
          </div>
        </CardContent>
      </Card>

      {/* Diet */}
      <Card>
        <CardHeader>
          <CardTitle>Diet</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              What dietary preferences does this recipe fit? (select all that apply)
            </p>
            <TagChipSelect
              namespace="DIET"
              selectedTags={selectedDiet}
              onSelectionChange={onDietChange}
              multiple={true}
              required={false}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
