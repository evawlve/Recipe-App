"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchBox = SearchBox;
const react_1 = require("react");
const navigation_1 = require("next/navigation");
const input_1 = require("@/components/ui/input");
const button_1 = require("@/components/ui/button");
const lucide_react_1 = require("lucide-react");
function SearchBox({ initialQuery = "" }) {
    const [query, setQuery] = (0, react_1.useState)(initialQuery);
    const router = (0, navigation_1.useRouter)();
    const searchParams = (0, navigation_1.useSearchParams)();
    const handleSubmit = (0, react_1.useCallback)((e) => {
        e.preventDefault();
        const params = new URLSearchParams(searchParams.toString());
        if (query.trim()) {
            params.set("q", query.trim());
        }
        else {
            params.delete("q");
        }
        // Reset to page 1 when searching
        params.delete("page");
        router.push(`/recipes?${params.toString()}`);
    }, [query, router, searchParams]);
    const handleClear = (0, react_1.useCallback)(() => {
        setQuery("");
        const params = new URLSearchParams(searchParams.toString());
        params.delete("q");
        params.delete("page");
        router.push(`/recipes?${params.toString()}`);
    }, [router, searchParams]);
    return (<div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <lucide_react_1.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
          <input_1.Input type="text" placeholder="Search recipes..." value={query} onChange={(e) => setQuery(e.target.value)} className="pl-10 pr-10"/>
          {query && (<button_1.Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0" onClick={handleClear}>
              ×
            </button_1.Button>)}
        </div>
        <button_1.Button type="submit" disabled={!query.trim()}>
          Search
        </button_1.Button>
      </form>
      
      {/* Show "View All Recipes" button when there's an active search or filters */}
      {(query || searchParams.get("tags")) && (<div className="flex items-center gap-2">
          <button_1.Button type="button" variant="outline" size="sm" onClick={handleClear} className="text-sm">
            ← View All Recipes
          </button_1.Button>
          <span className="text-sm text-muted-foreground">
            {query && `Searching for "${query}"`}
            {searchParams.get("tags") && ` • Filtered by tags`}
          </span>
        </div>)}
    </div>);
}
