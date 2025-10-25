"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface Tag {
  id: string;
  slug: string;
  label: string;
  namespace: string;
}

interface TagChipSelectProps {
  namespace: string;
  selectedTags: string[];
  onSelectionChange: (selectedTags: string[]) => void;
  multiple?: boolean;
  required?: boolean;
  className?: string;
}

export function TagChipSelect({
  namespace,
  selectedTags,
  onSelectionChange,
  multiple = false,
  required = false,
  className = ""
}: TagChipSelectProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTags = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/tags?namespace=${namespace}`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch tags");
        }
        
        setTags(data.tags);
      } catch (err) {
        console.error("Error fetching tags:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch tags");
      } finally {
        setLoading(false);
      }
    };

    fetchTags();
  }, [namespace]);

  const handleTagClick = (tagId: string) => {
    if (multiple) {
      // Multi-select logic
      if (selectedTags.includes(tagId)) {
        onSelectionChange(selectedTags.filter(id => id !== tagId));
      } else {
        onSelectionChange([...selectedTags, tagId]);
      }
    } else {
      // Single-select logic
      if (selectedTags.includes(tagId)) {
        onSelectionChange([]);
      } else {
        onSelectionChange([tagId]);
      }
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm text-muted-foreground">Loading tags...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-sm text-destructive ${className}`}>
        Error loading tags: {error}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const isSelected = selectedTags.includes(tag.id);
          return (
            <Button
              key={tag.id}
              type="button"
              variant={isSelected ? "default" : "outline"}
              size="sm"
              onClick={() => handleTagClick(tag.id)}
              className="h-auto py-1 px-3"
            >
              {tag.label}
            </Button>
          );
        })}
      </div>
      
      {required && selectedTags.length === 0 && (
        <p className="text-sm text-destructive">
          Please select at least one option
        </p>
      )}
    </div>
  );
}
