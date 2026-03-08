"use client";

import { useEffect, useMemo, useState } from "react";
import { SelectableRecipeCard } from "@/components/recipe/SelectableRecipeCard";
import { RecipeCard } from "@/components/recipe/RecipeCard";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface RecipeItem {
  id: string;
  title: string;
  createdAt: Date;
  author: { 
    id: string;
    name: string | null; 
    username: string | null; 
    displayName: string | null; 
    avatarKey: string | null; 
  };
  photos: Array<{
    id: string;
    s3Key: string;
    width: number;
    height: number;
  }>;
}

interface RecipeGridProps {
  items: RecipeItem[];
  currentUserId?: string | null;
  mode?: "saved" | "uploaded";
  onItemsChange?: (items: RecipeItem[], meta?: { newCount?: number }) => void;
}

export default function RecipeGrid({ items, currentUserId, mode, onItemsChange }: RecipeGridProps) {
  const [localItems, setLocalItems] = useState(items);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setLocalItems(items);
    setSelectedIds([]);
    setIsSelectionMode(false);
  }, [items]);

  const selectableItems = useMemo(() => {
    if (!mode) return [];
    if (mode === "uploaded") {
      return localItems.filter(item => item.author.id === currentUserId);
    }
    return localItems;
  }, [mode, localItems, currentUserId]);

  const toggleSelectionMode = () => {
    setIsSelectionMode((prev) => {
      const next = !prev;
      if (!next) setSelectedIds([]);
      return next;
    });
  };

  const handleSelectionChange = (recipeId: string, selected: boolean) => {
    setSelectedIds((prev) => {
      if (selected) {
        if (prev.includes(recipeId)) return prev;
        return [...prev, recipeId];
      }
      return prev.filter((id) => id !== recipeId);
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.length === selectableItems.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableItems.map((item) => item.id));
    }
  };

  const handleBulkDelete = async () => {
    if (!mode || selectedIds.length === 0) return;

    const warningMessage = mode === "uploaded"
      ? `Warning: Delete ${selectedIds.length} uploaded recipe${selectedIds.length > 1 ? "s" : ""}? This permanently removes them.`
      : `Warning: Remove ${selectedIds.length} saved recipe${selectedIds.length > 1 ? "s" : ""}? They will disappear from your Saved list.`;

    const confirmed = window.confirm(warningMessage);
    if (!confirmed) return;

    try {
      setIsProcessing(true);
      const response = await fetch(mode === "uploaded" ? "/api/recipes/bulk-delete" : "/api/me/saved/bulk-delete", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ recipeIds: selectedIds })
      });

      if (!response.ok) {
        const message = await response.text().catch(() => "Failed to delete recipes");
        throw new Error(message);
      }

      const result = await response.json();
      const updatedItems = localItems.filter((item) => !selectedIds.includes(item.id));
      const removedCount = typeof result.removedCount === "number"
        ? result.removedCount
        : typeof result.deletedCount === "number"
          ? result.deletedCount
          : selectedIds.length;
      const newCount = typeof result.savedCount === "number" ? result.savedCount : updatedItems.length;

      setLocalItems(updatedItems);
      setSelectedIds([]);
      setIsSelectionMode(false);
      onItemsChange?.(updatedItems, { newCount });

      alert(
        mode === "uploaded"
          ? `Deleted ${removedCount} recipe${removedCount === 1 ? "" : "s"}.`
          : `Removed ${removedCount} recipe${removedCount === 1 ? "" : "s"} from Saved.`
      );
    } catch (error) {
      console.error("Bulk delete error:", error);
      alert(error instanceof Error ? error.message : "Failed to delete recipes");
    } finally {
      setIsProcessing(false);
    }
  };

  if (localItems.length === 0) {
    return (
      <Card className="rounded-2xl border border-border bg-card shadow-sm p-12">
        <div className="text-center">
          <div className="text-6xl mb-4">📝</div>
          <h3 className="text-xl font-semibold text-foreground mb-2">No recipes yet</h3>
          <p className="text-muted-foreground">
            Start creating or saving recipes to see them here.
          </p>
        </div>
      </Card>
    );
  }

  const renderRecipeCard = (item: RecipeItem) => {
    const recipe = {
      id: item.id,
      title: item.title,
      bodyMd: "",
      servings: 1,
      prepTime: null,
      authorId: item.author.id,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      parentId: null,
      photos: item.photos,
      nutrition: null,
      author: item.author,
      _count: { likes: 0, comments: 0 }
    };

    if (mode) {
      return (
        <SelectableRecipeCard
          key={item.id}
          recipe={recipe}
          isSelected={selectedIds.includes(item.id)}
          onSelectionChange={(recipeId, selected) => handleSelectionChange(recipeId, Boolean(selected))}
          canSelect={isSelectionMode && (mode === "saved" || item.author.id === currentUserId)}
          currentUserId={currentUserId}
        />
      );
    }

    return <RecipeCard key={item.id} recipe={recipe} currentUserId={currentUserId} />;
  };

  return (
    <div className="space-y-4">
      {mode && selectableItems.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant={isSelectionMode ? "default" : "outline"}
              size="sm"
              onClick={toggleSelectionMode}
            >
              {isSelectionMode ? "Cancel selection" : "Select recipes"}
            </Button>
            {isSelectionMode && (
              <>
                <Button variant="outline" size="sm" onClick={handleSelectAll}>
                  {selectedIds.length === selectableItems.length ? "Deselect all" : "Select all"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {selectedIds.length} of {selectableItems.length} selected
                </span>
              </>
            )}
          </div>
          {isSelectionMode && selectedIds.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              disabled={isProcessing}
              onClick={handleBulkDelete}
            >
              {isProcessing ? "Deleting..." : mode === "uploaded" ? "Delete selected" : "Remove selected"}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {localItems.map((item) => renderRecipeCard(item))}
      </div>
    </div>
  );
}
