"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = LikeButton;
const react_1 = require("react");
const lucide_react_1 = require("lucide-react");
function LikeButton({ recipeId, initialCount, initiallyLiked }) {
    const [liked, setLiked] = (0, react_1.useState)(initiallyLiked);
    const [count, setCount] = (0, react_1.useState)(initialCount);
    const [pending, start] = (0, react_1.useTransition)();
    const [authError, setAuthError] = (0, react_1.useState)("");
    const [showPopup, setShowPopup] = (0, react_1.useState)(false);
    async function toggle() {
        start(async () => {
            const next = !liked;
            setLiked(next);
            setCount((c) => c + (next ? 1 : -1));
            const res = await fetch(`/api/recipes/${recipeId}/like`, { method: next ? "POST" : "DELETE" });
            if (!res.ok) {
                setLiked(!next);
                setCount((c) => c + (next ? -1 : 1));
                if (res.status === 401) {
                    setShowPopup(true);
                    setTimeout(() => setShowPopup(false), 3000); // Auto-hide after 3 seconds
                }
            }
            else {
                const j = await res.json();
                setLiked(j.liked);
                setCount(j.count);
                setAuthError("");
            }
        });
    }
    return (<div className="relative">
			<button onClick={toggle} disabled={pending} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border">
				<lucide_react_1.Heart className={`h-4 w-4 ${liked ? "fill-current text-red-500" : "text-muted"}`}/>
				<span className="text-sm">{count}</span>
			</button>
			
			{/* Popup overlay */}
			{showPopup && (<div className="absolute top-full right-0 mt-2 z-[100]">
					<div className="bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
						Please sign in
					</div>
				</div>)}
			
			{authError && (<div className="absolute top-full right-0 mt-2 z-[100]">
					<div className="bg-red-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap">
						Please sign in
					</div>
				</div>)}
		</div>);
}
