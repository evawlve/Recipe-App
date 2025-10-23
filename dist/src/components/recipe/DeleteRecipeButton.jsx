"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DeleteRecipeButton;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
function DeleteRecipeButton({ recipeId }) {
    const [busy, setBusy] = (0, react_1.useState)(false);
    const router = (0, navigation_1.useRouter)();
    async function onDelete() {
        if (!confirm("Delete this recipe? This cannot be undone."))
            return;
        try {
            setBusy(true);
            const res = await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
            if (!res.ok)
                throw new Error(await res.text().catch(() => "Delete failed"));
            router.replace("/recipes");
        }
        catch (e) {
            alert(e.message ?? "Delete failed");
        }
        finally {
            setBusy(false);
        }
    }
    return (<button onClick={onDelete} disabled={busy} className="inline-flex items-center rounded-md px-3 py-1.5 bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50">
      {busy ? "Deleting…" : "Delete Recipe"}
    </button>);
}
