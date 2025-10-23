"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = EditRecipeForm;
const react_1 = require("react");
const react_hook_form_1 = require("react-hook-form");
const zod_1 = require("@hookform/resolvers/zod");
const navigation_1 = require("next/navigation");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const input_1 = require("@/components/ui/input");
const textarea_1 = require("@/components/ui/textarea");
const alert_1 = require("@/components/ui/alert");
const useFocusManagement_1 = require("@/hooks/useFocusManagement");
const ImageUploader_1 = require("@/components/recipe/ImageUploader");
const TagsInput_1 = require("@/components/form/TagsInput");
const AuthGuard_1 = require("@/components/auth/AuthGuard");
const link_1 = __importDefault(require("next/link"));
const lucide_react_1 = require("lucide-react");
const image_1 = __importDefault(require("next/image"));
const images_1 = require("@/lib/images");
const validation_1 = require("@/lib/validation");
const NutritionSidebar_1 = require("@/components/recipe/NutritionSidebar");
const IngredientMappingModal_1 = require("@/components/recipe/IngredientMappingModal");
function EditRecipeFormComponent({ recipeId, initialData }) {
    const router = (0, navigation_1.useRouter)();
    const [isSubmitting, setIsSubmitting] = (0, react_1.useState)(false);
    const [submitError, setSubmitError] = (0, react_1.useState)(null);
    const [fileStates, setFileStates] = (0, react_1.useState)([]);
    const [isUploadingImages, setIsUploadingImages] = (0, react_1.useState)(false);
    const [existingPhotos, setExistingPhotos] = (0, react_1.useState)(initialData.photos);
    const [isMappingModalOpen, setIsMappingModalOpen] = (0, react_1.useState)(false);
    const [isSavingIngredients, setIsSavingIngredients] = (0, react_1.useState)(false);
    const [ingredientsSaved, setIngredientsSaved] = (0, react_1.useState)(false);
    const searchParams = (0, navigation_1.useSearchParams)();
    const form = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_1.zodResolver)(validation_1.recipeUpdateSchema),
        defaultValues: {
            title: initialData.title,
            servings: initialData.servings,
            bodyMd: initialData.bodyMd,
            ingredients: initialData.ingredients,
            tags: initialData.tags,
        },
    });
    const { register, control, handleSubmit, watch, setValue, formState: { errors } } = form;
    const { fields, append, remove } = (0, react_hook_form_1.useFieldArray)({
        control,
        name: "ingredients",
    });
    // Custom hooks for UX improvements
    (0, useFocusManagement_1.useFocusManagement)(errors);
    // Check for openMapping query parameter
    (0, react_1.useEffect)(() => {
        if (searchParams.get('openMapping') === 'true') {
            setIsMappingModalOpen(true);
        }
    }, [searchParams]);
    // Check if any files are uploading
    const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");
    const onSubmit = async (data) => {
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            // Get photos from successfully uploaded files
            const newPhotos = fileStates
                .filter(fs => fs.status === "done" && fs.s3Key && fs.dims)
                .map(fs => ({
                s3Key: fs.s3Key,
                width: fs.dims.width,
                height: fs.dims.height
            }));
            const payload = {
                ...data,
                // Note: We're not sending photos in the PATCH request
                // Photos are handled separately via the ImageUploader
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
            }
            else {
                setSubmitError(result.error || "Failed to update recipe. Please try again.");
            }
        }
        catch (error) {
            console.error("Error updating recipe:", error);
            setSubmitError("Network error. Please check your connection and try again.");
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const removeExistingPhoto = async (photoId) => {
        try {
            const response = await fetch(`/api/photos/${photoId}`, {
                method: "DELETE",
            });
            if (response.ok) {
                setExistingPhotos(prev => prev.filter(photo => photo.id !== photoId));
            }
            else {
                console.error("Failed to delete photo");
            }
        }
        catch (error) {
            console.error("Error deleting photo:", error);
        }
    };
    const saveIngredients = async () => {
        setIsSavingIngredients(true);
        setSubmitError(null);
        try {
            const currentData = form.getValues();
            const payload = {
                ingredients: currentData.ingredients,
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
            }
            else {
                setSubmitError(result.error || "Failed to save ingredients. Please try again.");
            }
        }
        catch (error) {
            console.error("Error saving ingredients:", error);
            setSubmitError("Network error. Please check your connection and try again.");
        }
        finally {
            setIsSavingIngredients(false);
        }
    };
    return (<div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-4">
          <button_1.Button variant="outline" asChild>
            <link_1.default href={`/recipes/${recipeId}`}>← Back to Recipe</link_1.default>
          </button_1.Button>
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

            <div className="flex gap-2">
              <button_1.Button type="button" variant="outline" onClick={() => append({ name: "", qty: 1, unit: "" })} disabled={isSubmitting || isSavingIngredients} className="flex-1">
                + Add Ingredient
              </button_1.Button>
              
              <button_1.Button type="button" onClick={saveIngredients} disabled={isSubmitting || isSavingIngredients} className="flex-1">
                {isSavingIngredients ? "Saving..." : "Save Ingredients"}
              </button_1.Button>
            </div>

            {ingredientsSaved && (<div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm text-green-800">
                  ✅ Ingredients saved successfully!
                </p>
              </div>)}

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

        {/* Existing Photos */}
        {existingPhotos.length > 0 && (<card_1.Card>
            <card_1.CardHeader>
              <card_1.CardTitle>Current Photos</card_1.CardTitle>
            </card_1.CardHeader>
            <card_1.CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {existingPhotos.map((photo) => (<div key={photo.id} className="relative group">
                    <div className="aspect-square rounded-lg overflow-hidden bg-muted-foreground/10">
                      <image_1.default src={(0, images_1.imageSrcForKey)(photo.s3Key)} alt="Recipe photo" width={photo.width} height={photo.height} className="w-full h-full object-cover"/>
                    </div>
                    <button_1.Button type="button" variant="destructive" size="sm" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => removeExistingPhoto(photo.id)}>
                      <lucide_react_1.Trash2 className="h-4 w-4"/>
                    </button_1.Button>
                  </div>))}
              </div>
            </card_1.CardContent>
          </card_1.Card>)}

        {/* Image Uploader */}
        <ImageUploader_1.ImageUploader fileStates={fileStates} onFileStatesChange={setFileStates} disabled={isSubmitting} onUploadStart={() => setIsUploadingImages(true)} onUploadComplete={() => setIsUploadingImages(false)}/>

        {/* Sticky Action Bar */}
        <div className="sticky bottom-0 bg-background border-t border-border p-4 -mx-4 -mb-8 mt-8">
          <div className="flex gap-4">
            <button_1.Button type="button" variant="outline" asChild className="flex-1">
              <link_1.default href={`/recipes/${recipeId}`}>Cancel</link_1.default>
            </button_1.Button>
            <button_1.Button type="submit" disabled={isSubmitting || hasUploadingFiles} className="flex-1">
              {isSubmitting ? "Saving…" : hasUploadingFiles ? "Uploading…" : "Save Changes"}
            </button_1.Button>
          </div>
        </div>
      </form>
        </div>

        {/* Nutrition Sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-8">
            <NutritionSidebar_1.NutritionSidebar recipeId={recipeId} onOpenMappingModal={() => setIsMappingModalOpen(true)}/>
          </div>
        </div>
      </div>

      {/* Ingredient Mapping Modal */}
      <IngredientMappingModal_1.IngredientMappingModal isOpen={isMappingModalOpen} onClose={() => setIsMappingModalOpen(false)} recipeId={recipeId} onMappingComplete={() => {
            // Refresh the nutrition sidebar
            window.location.reload();
        }}/>
    </div>);
}
function EditRecipeForm(props) {
    return (<AuthGuard_1.AuthGuard>
      <EditRecipeFormComponent {...props}/>
    </AuthGuard_1.AuthGuard>);
}
