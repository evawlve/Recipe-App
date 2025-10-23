"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BulkDeleteRecipes = BulkDeleteRecipes;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const button_1 = require("@/components/ui/button");
function BulkDeleteRecipes({ selectedRecipes, onClearSelection }) {
    const [isDeleting, setIsDeleting] = (0, react_1.useState)(false);
    const router = (0, navigation_1.useRouter)();
    const handleBulkDelete = async () => {
        if (selectedRecipes.length === 0)
            return;
        const confirmed = confirm(`Are you sure you want to delete ${selectedRecipes.length} recipe${selectedRecipes.length > 1 ? 's' : ''}? This action cannot be undone.`);
        if (!confirmed)
            return;
        try {
            setIsDeleting(true);
            const response = await fetch('/api/recipes/bulk-delete', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ recipeIds: selectedRecipes }),
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Delete failed');
                throw new Error(errorText);
            }
            const result = await response.json();
            if (result.success) {
                // Clear selection and refresh the page
                onClearSelection();
                router.refresh();
                // Show success message (you could use a toast here)
                alert(`Successfully deleted ${result.deletedCount} recipe${result.deletedCount > 1 ? 's' : ''}`);
            }
            else {
                throw new Error('Delete failed');
            }
        }
        catch (error) {
            console.error('Bulk delete error:', error);
            alert(error.message || 'Failed to delete recipes');
        }
        finally {
            setIsDeleting(false);
        }
    };
    if (selectedRecipes.length === 0) {
        return null;
    }
    return (<div className="fixed bottom-4 left-1/2 transform -translate-x-1/2 bg-destructive text-destructive-foreground rounded-lg shadow-lg p-4 z-50">
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">
          {selectedRecipes.length} recipe{selectedRecipes.length > 1 ? 's' : ''} selected
        </span>
        <div className="flex gap-2">
          <button_1.Button variant="outline" size="sm" onClick={onClearSelection} disabled={isDeleting} className="bg-background text-foreground hover:bg-background/80">
            Cancel
          </button_1.Button>
          <button_1.Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={isDeleting}>
            {isDeleting ? "Deleting..." : "Delete Selected"}
          </button_1.Button>
        </div>
      </div>
    </div>);
}
