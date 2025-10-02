"use client";

import { useState } from "react";
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
import { uploadFilesToS3 } from "@/lib/s3-upload";
import Link from "next/link";

export default function NewRecipePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  
  const form = useForm<RecipeCreateInput>({
    resolver: zodResolver(recipeCreateSchema),
    defaultValues: {
      title: "",
      servings: 1,
      bodyMd: "",
      ingredients: [{ name: "", qty: 1, unit: "" }],
      localFiles: [],
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

  // Watch localFiles for the ImageUploader
  const localFiles = watch("localFiles") || [];

  const onSubmit = async (data: RecipeCreateInput) => {
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      let photos: Array<{ s3Key: string; width: number; height: number }> = [];
      
      // Handle image uploads if there are any files
      if (data.localFiles && data.localFiles.length > 0) {
        setIsUploadingImages(true);
        setUploadingCount(data.localFiles.length);
        
        try {
          photos = await uploadFilesToS3(data.localFiles);
        } catch (uploadError) {
          console.error("Error uploading images:", uploadError);
          const errorMessage = uploadError instanceof Error 
            ? `Failed to upload images: ${uploadError.message}`
            : "Failed to upload images. Please try again.";
          setSubmitError(errorMessage);
          return;
        } finally {
          setIsUploadingImages(false);
          setUploadingCount(0);
        }
      }

      // Remove localFiles from the payload and add photos
      const { localFiles, ...recipeData } = data;
      const payload = {
        ...recipeData,
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
        router.push(`/recipes/${result.recipe.id}`);
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
      {isUploadingImages && (
        <Alert className="mb-6">
          <AlertDescription>
            Uploading {uploadingCount} file{uploadingCount !== 1 ? 's' : ''}...
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
          files={localFiles}
          onFilesChange={(files) => setValue("localFiles", files)}
          disabled={isSubmitting || isUploadingImages}
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
            disabled={isSubmitting}
            className="flex-1"
          >
            {isSubmitting ? "Creating…" : "Create Recipe"}
          </Button>
        </div>
      </form>
    </div>
  );
}
