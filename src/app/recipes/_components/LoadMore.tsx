"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

interface LoadMoreProps {
  cursor: string;
}

export function LoadMore({ cursor }: LoadMoreProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading) {
          loadMore();
        }
      },
      {
        rootMargin: "100px", // Start loading 100px before the sentinel comes into view
      }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [isLoading]);

  const loadMore = () => {
    if (isLoading) return;
    
    setIsLoading(true);
    
    // Update URL with cursor to trigger server-side fetch
    const params = new URLSearchParams(searchParams.toString());
    params.set('cursor', cursor);
    
    router.push(`/recipes?${params.toString()}`, { scroll: false });
    
    // Reset loading state after a short delay to prevent rapid firing
    setTimeout(() => setIsLoading(false), 1000);
  };

  return (
    <div ref={sentinelRef} className="flex justify-center py-8">
      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading more recipes...</span>
        </div>
      ) : (
        <Button
          variant="outline"
          onClick={loadMore}
          disabled={isLoading}
        >
          Load More Recipes
        </Button>
      )}
    </div>
  );
}
