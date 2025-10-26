"use client";
import { useState, useTransition } from "react";
import { ThumbsUp } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function LikeButton({ recipeId, initialCount, initiallyLiked }:{
	recipeId:string; initialCount:number; initiallyLiked:boolean;
}) {
	const [liked, setLiked] = useState(initiallyLiked);
	const [count, setCount] = useState(initialCount);
	const [pending, start] = useTransition();
	const [authError, setAuthError] = useState("");
	const [showPopup, setShowPopup] = useState(false);

	async function toggle() {
		start(async () => {
			const next = !liked;
			setLiked(next); setCount((c) => c + (next ? 1 : -1));
			const res = await fetch(`/api/recipes/${recipeId}/like`, { method: next ? "POST" : "DELETE" });
			if (!res.ok) {
				setLiked(!next); setCount((c) => c + (next ? -1 : 1));
				if (res.status === 401) {
					setShowPopup(true);
					setTimeout(() => setShowPopup(false), 3000); // Auto-hide after 3 seconds
				}
			} else {
				const j = await res.json();
				setLiked(j.liked); setCount(j.count);
				setAuthError("");
			}
		});
	}

	return (
		<div className="relative">
			<button onClick={toggle} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border">
				<ThumbsUp className={`h-4 w-4 ${liked ? "fill-current text-green-600" : "text-muted"}`} />
				<span className="text-sm">{count}</span>
			</button>
			
			{/* Popup overlay */}
			{showPopup && (
				<div className="absolute top-full right-0 mt-2 z-[100]">
					<div className="bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
						Please sign in
					</div>
				</div>
			)}
			
			{authError && (
				<div className="absolute top-full right-0 mt-2 z-[100]">
					<div className="bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
						Please sign in
					</div>
				</div>
			)}
		</div>
	);
}


