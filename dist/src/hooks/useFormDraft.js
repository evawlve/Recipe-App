"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useFormDraft = useFormDraft;
const react_1 = require("react");
const DRAFT_KEY = "recipe-form-draft";
function useFormDraft(form, isSubmitting) {
    // Save draft to localStorage whenever form values change
    (0, react_1.useEffect)(() => {
        if (isSubmitting)
            return; // Don't save while submitting
        const subscription = form.watch((data) => {
            // Only save if there's meaningful data
            if (data.title || data.bodyMd || (data.ingredients && data.ingredients.length > 0)) {
                localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
            }
        });
        return () => subscription.unsubscribe();
    }, [form, isSubmitting]);
    // Restore draft from localStorage on mount
    (0, react_1.useEffect)(() => {
        const savedDraft = localStorage.getItem(DRAFT_KEY);
        if (savedDraft) {
            try {
                const draftData = JSON.parse(savedDraft);
                form.reset(draftData);
            }
            catch (error) {
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
