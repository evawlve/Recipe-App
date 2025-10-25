"use client";

import { useState, useRef, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { recipeCreateSchema, RecipeCreateInput } from "@/lib/validation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFormDraft } from "@/hooks/useFormDraft";
import { useFocusManagement } from "@/hooks/useFocusManagement";
import { ImageUploader } from "@/components/recipe/ImageUploader";
import { TagsInput } from "@/components/form/TagsInput";
import { FileState } from "@/types/file-state";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { MealTypeStep } from "./_components/MealTypeStep";
import { OptionalTaxonomy } from "./_components/OptionalTaxonomy";
import Link from "next/link";

function NewRecipeForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileStates, setFileStates] = useState<FileState[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const mealTypeRef = useRef<HTMLDivElement>(null);
  
  const form = useForm<RecipeCreateInput>({
    resolver: zodResolver(recipeCreateSchema),
    defaultValues: {
      title: "",
      servings: 1,
      bodyMd: "",
      ingredients: [{ name: "", qty: 1, unit: "" }],
      tags: [],
      mealType: [],
      cuisine: [],
      method: [],
      diet: [],
    },
  });

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: "ingredients",
  });

  // Custom hooks for UX improvements
  const { clearDraft } = useFormDraft(form, isSubmitting);
  useFocusManagement(errors);

  // Scroll to meal type section when there's a meal type error
  useEffect(() => {
    if (errors.mealType && mealTypeRef.current) {
      // Small delay to ensure the error message is rendered
      setTimeout(() => {
        mealTypeRef.current?.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center' 
        });
      }, 100);
    }
  }, [errors.mealType]);

  // Check if any files are uploading
  const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");

  const onSubmit = async (data: RecipeCreateInput) => {
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      // Get photos from successfully uploaded files
      const photos = fileStates
        .filter(fs => fs.status === "done" && fs.s3Key && fs.dims)
        .map(fs => ({
          s3Key: fs.s3Key!,
          width: fs.dims!.width,
          height: fs.dims!.height
        }));

      // Debug logging
      console.log('File states:', fileStates);
      console.log('File states details:', fileStates.map(fs => ({
        name: fs.file.name,
        status: fs.status,
        hasS3Key: !!fs.s3Key,
        hasDims: !!fs.dims
      })));
      console.log('Filtered photos:', photos);
      console.log('Number of photos being sent:', photos.length);

      const payload = {
        ...data,
        photos,
      };

      const response = await fetch("/api/recipes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        clearDraft(); // Clear the draft on successful submission
        // Show success message with auto-mapping info
        console.log('Recipe created successfully! Ingredients have been automatically mapped for nutrition calculation.');
        router.push(`/recipes/${result.recipe.id}?created=1`);
      } else {
        setSubmitError(result.error || "Failed to create recipe. Please try again.");
      }
    } catch (error) {
      console.error("Error creating recipe:", error);
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="outline" asChild>
            <Link href="/recipes">← Back to Recipes</Link>
          </Button>
        </div>
        <h1 className="text-3xl font-bold text-text">Create New Recipe</h1>
        <p className="text-muted-foreground mt-2">
          Fill in the details below to create your recipe
        </p>
      </div>

      {/* Error Alert */}
      {submitError && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}

      {/* Uploading Progress */}
      {hasUploadingFiles && (
        <Alert className="mb-6">
          <AlertDescription>
            Uploading images... Please wait.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-text mb-2">
                Recipe Title *
              </label>
              <Input
                id="title"
                {...register("title")}
                placeholder="Enter recipe title"
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-sm text-destructive mt-1">{errors.title.message}</p>
              )}
            </div>

            <div>
              <label htmlFor="servings" className="block text-sm font-medium text-text mb-2">
                Servings *
              </label>
              <Input
                id="servings"
                type="number"
                min="1"
                {...register("servings", { valueAsNumber: true })}
                placeholder="Number of servings"
                className={errors.servings ? "border-destructive" : ""}
              />
              {errors.servings && (
                <p className="text-sm text-destructive mt-1">{errors.servings.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Meal Type Classification */}
        <div ref={mealTypeRef}>
          <MealTypeStep
            selectedMealType={watch("mealType") || []}
            onMealTypeChange={(selectedTags) => setValue("mealType", selectedTags)}
            error={errors.mealType?.message}
          />
        </div>

        {/* Optional Taxonomy */}
        <OptionalTaxonomy
          selectedCuisine={watch("cuisine") || []}
          onCuisineChange={(selectedTags) => setValue("cuisine", selectedTags)}
          selectedMethod={watch("method") || []}
          onMethodChange={(selectedTags) => setValue("method", selectedTags)}
          selectedDiet={watch("diet") || []}
          onDietChange={(selectedTags) => setValue("diet", selectedTags)}
        />

        {/* Ingredients */}
        <Card>
          <CardHeader>
            <CardTitle>Ingredients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Quantity
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    {...register(`ingredients.${index}.qty`, { valueAsNumber: true })}
                    placeholder="1"
                    className={errors.ingredients?.[index]?.qty ? "border-destructive" : ""}
                  />
                  {errors.ingredients?.[index]?.qty && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.qty?.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Unit
                  </label>
                  <Input
                    {...register(`ingredients.${index}.unit`)}
                    placeholder="cup, tbsp, etc."
                    className={errors.ingredients?.[index]?.unit ? "border-destructive" : ""}
                  />
                  {errors.ingredients?.[index]?.unit && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.unit?.message}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Ingredient Name
                  </label>
                  <Input
                    {...register(`ingredients.${index}.name`)}
                    placeholder="Flour, sugar, etc."
                    className={errors.ingredients?.[index]?.name ? "border-destructive" : ""}
                  />
                  {errors.ingredients?.[index]?.name && (
                    <p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.name?.message}
                    </p>
                  )}
                </div>

                <div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => remove(index)}
                    disabled={fields.length === 1 || isSubmitting}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              onClick={() => append({ name: "", qty: 1, unit: "" })}
              disabled={isSubmitting}
              className="w-full"
            >
              + Add Ingredient
            </Button>

            {errors.ingredients && (
              <p className="text-sm text-destructive">
                {errors.ingredients.message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Tags */}
        <Card>
          <CardHeader>
            <CardTitle>Tags</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-text mb-2">
                Recipe Tags
              </label>
              <TagsInput
                value={watch("tags") || []}
                onChange={(tags) => setValue("tags", tags)}
                placeholder="Add tags like 'vegetarian', 'quick', 'dessert'..."
                maxTags={10}
              />
              {errors.tags && (
                <p className="text-sm text-destructive mt-1">{errors.tags.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle>Instructions</CardTitle>
          </CardHeader>
          <CardContent>
            <div>
              <label htmlFor="bodyMd" className="block text-sm font-medium text-text mb-2">
                Recipe Instructions *
              </label>
              <Textarea
                id="bodyMd"
                {...register("bodyMd")}
                placeholder="Enter step-by-step instructions..."
                rows={8}
                className={errors.bodyMd ? "border-destructive" : ""}
              />
              {errors.bodyMd && (
                <p className="text-sm text-destructive mt-1">{errors.bodyMd.message}</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Image Uploader */}
        <ImageUploader
          fileStates={fileStates}
          onFileStatesChange={setFileStates}
          disabled={isSubmitting}
          onUploadStart={() => setIsUploadingImages(true)}
          onUploadComplete={() => setIsUploadingImages(false)}
        />

        {/* Submit Button */}
        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            asChild
            className="flex-1"
          >
            <Link href="/recipes">Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting || hasUploadingFiles}
            className="flex-1"
          >
            {isSubmitting ? "Creating…" : hasUploadingFiles ? "Uploading…" : "Create Recipe"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function NewRecipePage() {
  return (
    <AuthGuard>
      <NewRecipeForm />
    </AuthGuard>
  );
}
