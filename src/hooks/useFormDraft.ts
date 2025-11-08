import { useEffect } from "react";
import { UseFormReturn } from "react-hook-form";
import { RecipeCreateFormValues, RecipeCreateInput } from "@/lib/validation";

const DRAFT_KEY = "recipe-form-draft";

export function useFormDraft(
  form: UseFormReturn<RecipeCreateFormValues, any, RecipeCreateInput>,
  isSubmitting: boolean
) {
  // Save draft to localStorage whenever form values change
  useEffect(() => {
    if (isSubmitting) return; // Don't save while submitting

    const subscription = form.watch((data) => {
      // Only save if there's meaningful data
      if (data.title || data.bodyMd || (data.ingredients && data.ingredients.length > 0)) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      }
    });

    return () => subscription.unsubscribe();
  }, [form, isSubmitting]);

  // Restore draft from localStorage on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem(DRAFT_KEY);
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        form.reset(draftData);
      } catch (error) {
        console.error("Failed to restore form draft:", error);
        localStorage.removeItem(DRAFT_KEY);
      }
    }
  }, [form]);

  // Clear draft after successful submission
  const clearDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
  };

  return { clearDraft };
}
