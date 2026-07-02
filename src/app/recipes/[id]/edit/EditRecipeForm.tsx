"use client";

import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useFocusManagement } from "@/hooks/useFocusManagement";
import { ImageUploader } from "@/components/recipe/ImageUploader";
import { TagsInput } from "@/components/form/TagsInput";
import { FileState } from "@/types/file-state";
import { AuthGuard } from "@/components/auth/AuthGuard";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import Image from "next/image";
import { imageSrcForKey } from "@/lib/images";
import { recipeUpdateSchema, RecipeUpdateInput } from "@/lib/validation";
import { NutritionSidebar } from "@/components/recipe/NutritionSidebar";
import { IngredientMappingModal } from "@/components/recipe/IngredientMappingModal";
import { PrepTimeSelector, PrepTime } from "@/components/recipe/PrepTimeSelector";
import { parseIngredientInput, formatIngredientLineForDisplay } from "@/lib/ingredients/format";

interface EditRecipeFormProps {
  recipeId: string;
  initialData: {
    title: string;
    servings: number;
    bodyMd: string;
    prepTime?: PrepTime;
    ingredients: Array<{
      id?: string;
      name: string;
      qty: number;
      unit: string;
    }>;
    tags: string[];
    photos: Array<{
      id: string;
      s3Key: string;
      width: number;
      height: number;
    }>;
  };
}

function EditRecipeFormComponent({ recipeId, initialData }: EditRecipeFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fileStates, setFileStates] = useState<FileState[]>([]);
  const [isUploadingImages, setIsUploadingImages] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState(initialData.photos);
  const [isMappingModalOpen, setIsMappingModalOpen] = useState(false);
  const [isSavingIngredients, setIsSavingIngredients] = useState(false);
  const [ingredientsSaved, setIngredientsSaved] = useState(false);
  const searchParams = useSearchParams();

  const createEmptyIngredient = () => ({
    name: "",
    qty: 1,
    unit: "",
    original: "",
  });

  const form = useForm<RecipeUpdateInput>({
    resolver: zodResolver(recipeUpdateSchema),
    defaultValues: {
      title: initialData.title,
      servings: initialData.servings,
      bodyMd: initialData.bodyMd,
      prepTime: initialData.prepTime,
      ingredients: initialData.ingredients.map((ingredient) => ({
        ...ingredient,
        original: formatIngredientLineForDisplay(ingredient),
      })),
      tags: initialData.tags,
    },
  });

  const { register, control, handleSubmit, watch, setValue, formState: { errors } } = form;

  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "ingredients",
  });

  // Custom hooks for UX improvements
  useFocusManagement(errors);

  // Check for openMapping query parameter
  useEffect(() => {
    if (searchParams.get('openMapping') === 'true') {
      setIsMappingModalOpen(true);
    }
  }, [searchParams]);

  // Check if any files are uploading
  const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");

  const onSubmit = async (data: RecipeUpdateInput) => {
    setIsSubmitting(true);
    setSubmitError(null);
    
    try {
      // Get photos from successfully uploaded files
      const newPhotos = fileStates
        .filter(fs => fs.status === "done" && fs.s3Key && fs.dims)
        .map(fs => ({
          s3Key: fs.s3Key!,
          width: fs.dims!.width,
          height: fs.dims!.height
        }));

      const payload = {
        ...data,
        // Include newly uploaded photos if any
        ...(newPhotos.length > 0 ? { photos: newPhotos } : {})
      };

      const response = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        router.push(`/recipes/${recipeId}`);
      } else {
        setSubmitError(result.error || "Failed to update recipe. Please try again.");
      }
    } catch (error) {
      console.error("Error updating recipe:", error);
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeExistingPhoto = async (photoId: string) => {
    try {
      const response = await fetch(`/api/photos/${photoId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setExistingPhotos(prev => prev.filter(photo => photo.id !== photoId));
      } else {
        console.error("Failed to delete photo");
      }
    } catch (error) {
      console.error("Error deleting photo:", error);
    }
  };

  const handleFilteredSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const currentIngredients = form.getValues("ingredients") ?? [];
    const filteredIngredients = currentIngredients.filter(
      (ingredient) => ingredient.name && ingredient.name.trim().length > 0
    );

    if (filteredIngredients.length === 0) {
      replace([createEmptyIngredient()]);
      form.setError("ingredients", {
        type: "manual",
        message: "At least one ingredient is required.",
      });
      return;
    }

    if (filteredIngredients.length !== currentIngredients.length) {
      replace(
        filteredIngredients.map((ingredient) => ({
          ...ingredient,
          original: ingredient.original ?? "",
        }))
      );
    }

    form.clearErrors("ingredients");
    await handleSubmit(onSubmit)();
  };

  const saveIngredients = async () => {
    setSubmitError(null);
    setIngredientsSaved(false);

    const currentIngredients = form.getValues("ingredients") ?? [];
    const filteredIngredients = currentIngredients.filter(
      (ingredient) => ingredient.name && ingredient.name.trim().length > 0
    );

    if (filteredIngredients.length === 0) {
      replace([createEmptyIngredient()]);
      form.setError("ingredients", {
        type: "manual",
        message: "At least one ingredient is required.",
      });
      return;
    }

    if (filteredIngredients.length !== currentIngredients.length) {
      replace(
        filteredIngredients.map((ingredient) => ({
          ...ingredient,
          original: ingredient.original ?? "",
        }))
      );
    }

    form.clearErrors("ingredients");
    setIsSavingIngredients(true);
    
    try {
      const payload = {
        ingredients: filteredIngredients,
      };

      const response = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        setIngredientsSaved(true);
        // Hide success message after 3 seconds
        setTimeout(() => setIngredientsSaved(false), 3000);
      } else {
        setSubmitError(result.error || "Failed to save ingredients. Please try again.");
      }
    } catch (error) {
      console.error("Error saving ingredients:", error);
      setSubmitError("Network error. Please check your connection and try again.");
    } finally {
      setIsSavingIngredients(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <Button variant="outline" asChild>
            <Link href={`/recipes/${recipeId}`}>← Back to Recipe</Link>
          </Button>
        </div>
        <h1 className="text-3xl font-bold text-text">Edit Recipe</h1>
        <p className="text-muted-foreground mt-2">
          Update your recipe details below
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Form */}
        <div className="lg:col-span-2">

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

      <form onSubmit={handleFilteredSubmit} className="space-y-6">
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

            <PrepTimeSelector
              value={watch("prepTime")}
              onChange={(value) => setValue("prepTime", value)}
              error={errors.prepTime?.message}
            />
          </CardContent>
        </Card>

        {/* Ingredients */}
        <Card>
          <CardHeader>
            <CardTitle>Ingredients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.map((field, index) => (
              <div key={field.id}>
                <label className="block text-sm font-medium text-text mb-2">
                  Ingredient *
                </label>
                <div className="flex flex-col gap-2 md:flex-row md:items-end md:gap-4">
                  <div className="flex-1">
                    <Controller
                      control={control}
                      name={`ingredients.${index}.original`}
                      render={({ field: ingredientField }) => (
                        <Input
                          {...ingredientField}
                          value={ingredientField.value ?? ""}
                          placeholder="e.g. 1/2 an onion, finely chopped"
                          className={errors.ingredients?.[index]?.name ? "border-destructive" : ""}
                          onChange={(event) => {
                            const value = event.target.value;
                            ingredientField.onChange(value);
                            const parsed = parseIngredientInput(value);
                            setValue(`ingredients.${index}.qty`, parsed.qty, { shouldDirty: true });
                            setValue(`ingredients.${index}.unit`, parsed.unit, { shouldDirty: true });
                            setValue(`ingredients.${index}.name`, parsed.name, { shouldDirty: true });
                            const hasNonEmptyIngredient = (form.getValues("ingredients") ?? []).some(
                              (ingredient) => ingredient.name && ingredient.name.trim().length > 0
                            );
                            if (hasNonEmptyIngredient) {
                              form.clearErrors("ingredients");
                            }
                          }}
                          onBlur={(event) => {
                            const value = event.target.value;
                            const parsed = parseIngredientInput(value);
                            setValue(`ingredients.${index}.qty`, parsed.qty, { shouldDirty: true });
                            setValue(`ingredients.${index}.unit`, parsed.unit, { shouldDirty: true });
                            setValue(`ingredients.${index}.name`, parsed.name, { shouldDirty: true });
                            ingredientField.onBlur();
                          }}
                        />
                      )}
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
                      disabled={fields.length === 1 || isSubmitting || isSavingIngredients}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <input type="hidden" {...register(`ingredients.${index}.qty`, { valueAsNumber: true })} />
                <input type="hidden" {...register(`ingredients.${index}.unit`)} />
                <input type="hidden" {...register(`ingredients.${index}.name`)} />
              </div>
            ))}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => append(createEmptyIngredient())}
                disabled={isSubmitting || isSavingIngredients}
                className="flex-1"
              >
                + Add Ingredient
              </Button>
              
              <Button
                type="button"
                onClick={saveIngredients}
                disabled={isSubmitting || isSavingIngredients}
                className="flex-1"
              >
                {isSavingIngredients ? "Saving..." : "Save Ingredients"}
              </Button>
            </div>

            {ingredientsSaved && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  ✅ Ingredients saved successfully!
                </p>
              </div>
            )}

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

        {/* Existing Photos */}
        {existingPhotos.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Current Photos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {existingPhotos.map((photo) => (
                  <div key={photo.id} className="relative group">
                    <div className="aspect-square rounded-lg overflow-hidden bg-muted-foreground/10">
                      <Image
                        src={imageSrcForKey(photo.s3Key)}
                        alt="Recipe photo"
                        width={photo.width}
                        height={photo.height}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => removeExistingPhoto(photo.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Image Uploader */}
        <ImageUploader
          fileStates={fileStates}
          onFileStatesChange={setFileStates}
          disabled={isSubmitting}
          onUploadStart={() => setIsUploadingImages(true)}
          onUploadComplete={() => setIsUploadingImages(false)}
        />

        {/* Sticky Action Bar */}
        <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-4 -mb-8 mt-8">
          <div className="flex gap-4">
            <Button
              type="button"
              variant="outline"
              asChild
              className="flex-1"
            >
              <Link href={`/recipes/${recipeId}`}>Cancel</Link>
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || hasUploadingFiles}
              className="flex-1"
            >
              {isSubmitting ? "Saving…" : hasUploadingFiles ? "Uploading…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </form>
        </div>

        {/* Nutrition Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-8">
            <NutritionSidebar 
              recipeId={recipeId}
              onOpenMappingModal={() => setIsMappingModalOpen(true)}
            />
          </div>
        </div>
      </div>

      {/* Ingredient Mapping Modal */}
      <IngredientMappingModal
        isOpen={isMappingModalOpen}
        onClose={() => setIsMappingModalOpen(false)}
        recipeId={recipeId}
        onMappingComplete={() => {
          // Close the modal after successful mapping
          setIsMappingModalOpen(false);
          // Note: The nutrition sidebar should refresh automatically
          // No need to reload the entire page
        }}
      />
    </div>
  );
}

export default function EditRecipeForm(props: EditRecipeFormProps) {
  return (
    <AuthGuard>
      <EditRecipeFormComponent {...props} />
    </AuthGuard>
  );
}
