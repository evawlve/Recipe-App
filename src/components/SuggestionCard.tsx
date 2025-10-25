"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Lightbulb, Check } from "lucide-react";

interface SuggestionCardProps {
  recipeId: string;
}

interface Suggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  namespace: string;
  slug: string;
}

export function SuggestionCard({ recipeId }: SuggestionCardProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchSuggestions = async () => {
      try {
        setLoading(true);
        setError(null);
        
        const response = await fetch(`/api/recipes/${recipeId}/suggestions`);
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || "Failed to fetch suggestions");
        }
        
        setSuggestions(data.suggestions || []);
      } catch (err) {
        console.error("Error fetching suggestions:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch suggestions");
      } finally {
        setLoading(false);
      }
    };

    fetchSuggestions();
  }, [recipeId]);

  const handleAcceptSuggestion = async (suggestion: Suggestion) => {
    try {
      setAccepting(prev => new Set(prev).add(suggestion.id));
      
      const response = await fetch(`/api/recipes/${recipeId}/tags/accept`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tagSlug: suggestion.slug,
          namespace: suggestion.namespace
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to accept suggestion");
      }

      // Remove the accepted suggestion from the list
      setSuggestions(prev => prev.filter(s => s.id !== suggestion.id));
      
    } catch (err) {
      console.error("Error accepting suggestion:", err);
      setError(err instanceof Error ? err.message : "Failed to accept suggestion");
    } finally {
      setAccepting(prev => {
        const newSet = new Set(prev);
        newSet.delete(suggestion.id);
        return newSet;
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Help others find this recipe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">Loading suggestions...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Help others find this recipe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">Error loading suggestions: {error}</p>
        </CardContent>
      </Card>
    );
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Help others find this recipe
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No suggestions available at the moment. This feature will help improve recipe discoverability in the future.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Help others find this recipe
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {suggestions.map((suggestion) => (
            <div key={suggestion.id} className="p-3 border rounded-lg">
              <h4 className="font-medium text-sm">{suggestion.title}</h4>
              <p className="text-sm text-muted-foreground mt-1">
                {suggestion.description}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground">
                  Confidence: {Math.round(suggestion.confidence * 100)}%
                </span>
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleAcceptSuggestion(suggestion)}
                  disabled={accepting.has(suggestion.id)}
                >
                  {accepting.has(suggestion.id) ? (
                    <>
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    <>
                      <Check className="h-3 w-3 mr-1" />
                      Accept
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
