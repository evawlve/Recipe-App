"use client";

import { useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

interface SearchBoxProps {
  initialQuery?: string;
}

export function SearchBox({ initialQuery = "" }: SearchBoxProps) {
  const [query, setQuery] = useState(initialQuery);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    const params = new URLSearchParams(searchParams.toString());
    
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    
    // Reset to page 1 when searching
    params.delete("page");
    
    router.push(`/recipes?${params.toString()}`);
  }, [query, router, searchParams]);

  const handleClear = useCallback(() => {
    setQuery("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    params.delete("page");
    router.push(`/recipes?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search recipes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
              onClick={handleClear}
            >
              ×
            </Button>
          )}
        </div>
        <Button type="submit" disabled={!query.trim()}>
          Search
        </Button>
      </form>
      
      {/* Show "View All Recipes" button when there's an active search or filters */}
      {(query || searchParams.get("tags")) && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClear}
            className="text-sm"
          >
            ← View All Recipes
          </Button>
          <span className="text-sm text-muted-foreground">
            {query && `Searching for "${query}"`}
            {searchParams.get("tags") && ` • Filtered by tags`}
          </span>
        </div>
      )}
    </div>
  );
}
