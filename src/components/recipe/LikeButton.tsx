"use client";
import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LikeButton({ recipeId, initialCount, initiallyLiked }:{
	recipeId:string; initialCount:number; initiallyLiked:boolean;
}) {
	const [liked, setLiked] = useState(initiallyLiked);
	const [count, setCount] = useState(initialCount);
	const [pending, start] = useTransition();
	const [authError, setAuthError] = useState("");

	async function toggle() {
		start(async () => {
			const next = !liked;
			setLiked(next); setCount((c) => c + (next ? 1 : -1));
			const res = await fetch(`/api/recipes/${recipeId}/like`, { method: next ? "POST" : "DELETE" });
			if (!res.ok) {
				setLiked(!next); setCount((c) => c + (next ? -1 : 1));
				if (res.status === 401) setAuthError("Please sign in to like recipes.");
			} else {
				const j = await res.json();
				setLiked(j.liked); setCount(j.count);
				setAuthError("");
			}
		});
	}

	return (
		<div className="space-y-2">
			<button onClick={toggle} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border">
				<Heart className={`h-4 w-4 ${liked ? "fill-current text-red-500" : "text-muted"}`} />
				<span className="text-sm">{count}</span>
			</button>
			{authError && (
				<Alert className="py-2 px-3">
					<AlertDescription className="text-xs">{authError}</AlertDescription>
				</Alert>
			)}
		</div>
	);
}


