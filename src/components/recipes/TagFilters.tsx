"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface TagSuggestion {
  id: string;
  slug: string;
  label: string;
  count: number;
}

interface TagFiltersProps {
  selectedTags: string[];
}

export function TagFilters({ selectedTags }: TagFiltersProps) {
  const [popularTags, setPopularTags] = useState<TagSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // Fetch popular tags
  const fetchPopularTags = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/tags");
      
      if (response.ok) {
        const data = await response.json();
        setPopularTags(data.slice(0, 12)); // Top 12 tags
      } else {
        console.error("Tags API error:", response.status, response.statusText);
      }
    } catch (error) {
      console.error("Error fetching popular tags:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPopularTags();
  }, [fetchPopularTags]);

  const toggleTag = useCallback((tagSlug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const currentTags = params.getAll("tags");
    
    if (currentTags.includes(tagSlug)) {
      // Remove tag
      const newTags = currentTags.filter(t => t !== tagSlug);
      params.delete("tags");
      newTags.forEach(tag => params.append("tags", tag));
    } else {
      // Add tag
      params.append("tags", tagSlug);
    }
    
    // Reset to page 1 when filtering
    params.delete("page");
    
    router.push(`/recipes?${params.toString()}`);
  }, [router, searchParams]);

  const removeTag = useCallback((tagSlug: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const currentTags = params.getAll("tags");
    const newTags = currentTags.filter(t => t !== tagSlug);
    
    params.delete("tags");
    newTags.forEach(tag => params.append("tags", tag));
    params.delete("page");
    
    router.push(`/recipes?${params.toString()}`);
  }, [router, searchParams]);

  const clearAllTags = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tags");
    params.delete("page");
    router.push(`/recipes?${params.toString()}`);
  }, [router, searchParams]);

  return (
    <div className="space-y-4">
      {/* Show "View All Recipes" button when there are active filters */}
      {selectedTags.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAllTags}
            className="text-sm"
          >
            ← View All Recipes
          </Button>
          <span className="text-sm text-muted-foreground">
            Filtering by {selectedTags.length} tag{selectedTags.length !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Selected tags */}
      {selectedTags.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-text">Selected Tags</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAllTags}
              className="text-xs"
            >
              Clear all
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tagSlug) => {
              // Find the tag label from popular tags or use the slug
              const tag = popularTags.find(t => t.slug === tagSlug);
              const label = tag?.label || tagSlug.split('-').map(word => 
                word.charAt(0).toUpperCase() + word.slice(1)
              ).join(' ');
              
              return (
                <Badge
                  key={tagSlug}
                  variant="default"
                  className="flex items-center gap-1 pr-1"
                >
                  <span>{label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-4 w-4 p-0 hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => removeTag(tagSlug)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Popular tags */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text">Popular Tags</h3>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading tags...</div>
        ) : popularTags.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No tags available yet. Create some recipes with tags to see them here!
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {popularTags
              .filter(tag => !selectedTags.includes(tag.slug))
              .map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="cursor-pointer hover:bg-secondary"
                  onClick={() => toggleTag(tag.slug)}
                >
                  {tag.label}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({tag.count})
                  </span>
                </Badge>
              ))}
            {popularTags.filter(tag => !selectedTags.includes(tag.slug)).length === 0 && (
              <div className="text-sm text-muted-foreground">
                All available tags are already selected
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
