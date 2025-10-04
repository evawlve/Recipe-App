"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteRecipeButton({ recipeId }: { recipeId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onDelete() {
    if (!confirm("Delete this recipe? This cannot be undone.")) return;
    try {
      setBusy(true);
      const res = await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text().catch(() => "Delete failed"));
      router.replace("/recipes");
    } catch (e: any) {
      alert(e.message ?? "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onDelete}
      disabled={busy}
      className="inline-flex items-center rounded-md px-3 py-1.5 bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "Deleting…" : "Delete Recipe"}
    </button>
  );
}
