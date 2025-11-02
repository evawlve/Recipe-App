"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ClearFiltersButton() {
  const router = useRouter();

  const handleClearFilters = () => {
    // Navigate to /recipes without any query parameters to clear all filters
    router.push("/recipes");
  };

  return (
    <Button onClick={handleClearFilters}>
      View All Recipes
    </Button>
  );
}

