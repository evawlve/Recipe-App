"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = SaveButton;
const react_1 = require("react");
const lucide_react_1 = require("lucide-react");
function SaveButton({ recipeId, initiallySaved, variant = "full", isAuthenticated = true }) {
    const [saved, setSaved] = (0, react_1.useState)(initiallySaved);
    const [pending, start] = (0, react_1.useTransition)();
    const [authError, setAuthError] = (0, react_1.useState)("");
    const [showPopup, setShowPopup] = (0, react_1.useState)(false);
    async function toggle() {
        if (!isAuthenticated) {
            setShowPopup(true);
            setTimeout(() => setShowPopup(false), 3000); // Auto-hide after 3 seconds
            return;
        }
        start(async () => {
            const next = !saved;
            setSaved(next);
            const res = await fetch(`/api/recipes/${recipeId}/save`, {
                method: next ? "POST" : "DELETE"
            });
            if (!res.ok) {
                setSaved(!next);
                if (res.status === 401)
                    setAuthError("Please sign in to save recipes.");
            }
            else {
                const j = await res.json();
                setSaved(j.saved);
                setAuthError("");
            }
        });
    }
    if (variant === "small") {
        return (<div className="relative">
        <button onClick={toggle} disabled={pending} className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border transition-colors ${!isAuthenticated
                ? "hover:bg-muted cursor-pointer"
                : "hover:bg-secondary"}`} title={!isAuthenticated ? "Sign in to save recipes" : (saved ? "Remove from saved" : "Save recipe")}>
          <lucide_react_1.Bookmark className={`h-4 w-4 ${!isAuthenticated
                ? "text-muted-foreground"
                : saved
                    ? "fill-current text-blue-500"
                    : "text-muted"}`}/>
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
    return (<div className="relative">
      <button onClick={toggle} disabled={pending} className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-border transition-colors ${!isAuthenticated
            ? "hover:bg-muted cursor-pointer"
            : "hover:bg-secondary"}`}>
        <lucide_react_1.Bookmark className={`h-4 w-4 ${!isAuthenticated
            ? "text-muted-foreground"
            : saved
                ? "fill-current text-blue-500"
                : "text-muted"}`}/>
        <span className="text-sm">
          {!isAuthenticated ? "Sign in to save" : (saved ? "Saved" : "Save")}
        </span>
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
