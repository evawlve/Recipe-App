import { useEffect } from "react";
import { FieldErrors, FieldValues } from "react-hook-form";

export function useFocusManagement<TFieldValues extends FieldValues>(errors: FieldErrors<TFieldValues>) {
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;

    // Find the first field with an error
    const firstErrorField = Object.keys(errors)[0];
    
    // Focus the first invalid field
    const element = document.querySelector(`[name="${firstErrorField}"]`) as HTMLElement;
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [errors]);
}
