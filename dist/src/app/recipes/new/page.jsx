"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = NewRecipePage;
const react_1 = require("react");
const react_hook_form_1 = require("react-hook-form");
const zod_1 = require("@hookform/resolvers/zod");
const navigation_1 = require("next/navigation");
const validation_1 = require("@/lib/validation");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const input_1 = require("@/components/ui/input");
const textarea_1 = require("@/components/ui/textarea");
const alert_1 = require("@/components/ui/alert");
const useFormDraft_1 = require("@/hooks/useFormDraft");
const useFocusManagement_1 = require("@/hooks/useFocusManagement");
const ImageUploader_1 = require("@/components/recipe/ImageUploader");
const TagsInput_1 = require("@/components/form/TagsInput");
const AuthGuard_1 = require("@/components/auth/AuthGuard");
const link_1 = __importDefault(require("next/link"));
function NewRecipeForm() {
    const router = (0, navigation_1.useRouter)();
    const [isSubmitting, setIsSubmitting] = (0, react_1.useState)(false);
    const [submitError, setSubmitError] = (0, react_1.useState)(null);
    const [fileStates, setFileStates] = (0, react_1.useState)([]);
    const [isUploadingImages, setIsUploadingImages] = (0, react_1.useState)(false);
    const form = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_1.zodResolver)(validation_1.recipeCreateSchema),
        defaultValues: {
            title: "",
            servings: 1,
            bodyMd: "",
            ingredients: [{ name: "", qty: 1, unit: "" }],
            tags: [],
        },
    });
    const { register, control, handleSubmit, watch, setValue, formState: { errors } } = form;
    const { fields, append, remove } = (0, react_hook_form_1.useFieldArray)({
        control,
        name: "ingredients",
    });
    // Custom hooks for UX improvements
    const { clearDraft } = (0, useFormDraft_1.useFormDraft)(form, isSubmitting);
    (0, useFocusManagement_1.useFocusManagement)(errors);
    // Check if any files are uploading
    const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");
    const onSubmit = async (data) => {
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            // Get photos from successfully uploaded files
            const photos = fileStates
                .filter(fs => fs.status === "done" && fs.s3Key && fs.dims)
                .map(fs => ({
                s3Key: fs.s3Key,
                width: fs.dims.width,
                height: fs.dims.height
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
                router.push(`/recipes/${result.recipe.id}`);
            }
            else {
                setSubmitError(result.error || "Failed to create recipe. Please try again.");
            }
        }
        catch (error) {
            console.error("Error creating recipe:", error);
            setSubmitError("Network error. Please check your connection and try again.");
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (<div className="container mx-auto px-4 py-8 max-w-2xl">
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <button_1.Button variant="outline" asChild>
            <link_1.default href="/recipes">← Back to Recipes</link_1.default>
          </button_1.Button>
        </div>
        <h1 className="text-3xl font-bold text-text">Create New Recipe</h1>
        <p className="text-muted-foreground mt-2">
          Fill in the details below to create your recipe
        </p>
      </div>

      {/* Error Alert */}
      {submitError && (<alert_1.Alert variant="destructive" className="mb-6">
          <alert_1.AlertDescription>{submitError}</alert_1.AlertDescription>
        </alert_1.Alert>)}

      {/* Uploading Progress */}
      {hasUploadingFiles && (<alert_1.Alert className="mb-6">
          <alert_1.AlertDescription>
            Uploading images... Please wait.
          </alert_1.AlertDescription>
        </alert_1.Alert>)}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <card_1.Card>
          <card_1.CardHeader>
            <card_1.CardTitle>Basic Information</card_1.CardTitle>
          </card_1.CardHeader>
          <card_1.CardContent className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-text mb-2">
                Recipe Title *
              </label>
              <input_1.Input id="title" {...register("title")} placeholder="Enter recipe title" className={errors.title ? "border-destructive" : ""}/>
              {errors.title && (<p className="text-sm text-destructive mt-1">{errors.title.message}</p>)}
            </div>

            <div>
              <label htmlFor="servings" className="block text-sm font-medium text-text mb-2">
                Servings *
              </label>
              <input_1.Input id="servings" type="number" {...register("servings", { valueAsNumber: true })} placeholder="Number of servings" className={errors.servings ? "border-destructive" : ""}/>
              {errors.servings && (<p className="text-sm text-destructive mt-1">{errors.servings.message}</p>)}
            </div>
          </card_1.CardContent>
        </card_1.Card>

        {/* Ingredients */}
        <card_1.Card>
          <card_1.CardHeader>
            <card_1.CardTitle>Ingredients</card_1.CardTitle>
          </card_1.CardHeader>
          <card_1.CardContent className="space-y-4">
            {fields.map((field, index) => (<div key={field.id} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Quantity
                  </label>
                  <input_1.Input type="number" step="0.1" {...register(`ingredients.${index}.qty`, { valueAsNumber: true })} placeholder="1" className={errors.ingredients?.[index]?.qty ? "border-destructive" : ""}/>
                  {errors.ingredients?.[index]?.qty && (<p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.qty?.message}
                    </p>)}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Unit
                  </label>
                  <input_1.Input {...register(`ingredients.${index}.unit`)} placeholder="cup, tbsp, etc." className={errors.ingredients?.[index]?.unit ? "border-destructive" : ""}/>
                  {errors.ingredients?.[index]?.unit && (<p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.unit?.message}
                    </p>)}
                </div>

                <div>
                  <label className="block text-sm font-medium text-text mb-2">
                    Ingredient Name
                  </label>
                  <input_1.Input {...register(`ingredients.${index}.name`)} placeholder="Flour, sugar, etc." className={errors.ingredients?.[index]?.name ? "border-destructive" : ""}/>
                  {errors.ingredients?.[index]?.name && (<p className="text-sm text-destructive mt-1">
                      {errors.ingredients[index]?.name?.message}
                    </p>)}
                </div>

                <div>
                  <button_1.Button type="button" variant="destructive" size="sm" onClick={() => remove(index)} disabled={fields.length === 1 || isSubmitting}>
                    Remove
                  </button_1.Button>
                </div>
              </div>))}

            <button_1.Button type="button" variant="outline" onClick={() => append({ name: "", qty: 1, unit: "" })} disabled={isSubmitting} className="w-full">
              + Add Ingredient
            </button_1.Button>

            {errors.ingredients && (<p className="text-sm text-destructive">
                {errors.ingredients.message}
              </p>)}
          </card_1.CardContent>
        </card_1.Card>

        {/* Tags */}
        <card_1.Card>
          <card_1.CardHeader>
            <card_1.CardTitle>Tags</card_1.CardTitle>
          </card_1.CardHeader>
          <card_1.CardContent>
            <div>
              <label htmlFor="tags" className="block text-sm font-medium text-text mb-2">
                Recipe Tags
              </label>
              <TagsInput_1.TagsInput value={watch("tags") || []} onChange={(tags) => setValue("tags", tags)} placeholder="Add tags like 'vegetarian', 'quick', 'dessert'..." maxTags={10}/>
              {errors.tags && (<p className="text-sm text-destructive mt-1">{errors.tags.message}</p>)}
            </div>
          </card_1.CardContent>
        </card_1.Card>

        {/* Instructions */}
        <card_1.Card>
          <card_1.CardHeader>
            <card_1.CardTitle>Instructions</card_1.CardTitle>
          </card_1.CardHeader>
          <card_1.CardContent>
            <div>
              <label htmlFor="bodyMd" className="block text-sm font-medium text-text mb-2">
                Recipe Instructions *
              </label>
              <textarea_1.Textarea id="bodyMd" {...register("bodyMd")} placeholder="Enter step-by-step instructions..." rows={8} className={errors.bodyMd ? "border-destructive" : ""}/>
              {errors.bodyMd && (<p className="text-sm text-destructive mt-1">{errors.bodyMd.message}</p>)}
            </div>
          </card_1.CardContent>
        </card_1.Card>

        {/* Image Uploader */}
        <ImageUploader_1.ImageUploader fileStates={fileStates} onFileStatesChange={setFileStates} disabled={isSubmitting} onUploadStart={() => setIsUploadingImages(true)} onUploadComplete={() => setIsUploadingImages(false)}/>

        {/* Submit Button */}
        <div className="flex gap-4">
          <button_1.Button type="button" variant="outline" asChild className="flex-1">
            <link_1.default href="/recipes">Cancel</link_1.default>
          </button_1.Button>
          <button_1.Button type="submit" disabled={isSubmitting || hasUploadingFiles} className="flex-1">
            {isSubmitting ? "Creating…" : hasUploadingFiles ? "Uploading…" : "Create Recipe"}
          </button_1.Button>
        </div>
      </form>
    </div>);
}
function NewRecipePage() {
    return (<AuthGuard_1.AuthGuard>
      <NewRecipeForm />
    </AuthGuard_1.AuthGuard>);
}
