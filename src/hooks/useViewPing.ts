'use client';
import { useEffect, useRef, useState } from 'react';

export function useViewPing(recipeId: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (!ref.current || sent) return;
    
    let timeoutId: NodeJS.Timeout;
    
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          // Wait 600ms before sending the ping
          timeoutId = setTimeout(() => {
            fetch(`/api/recipes/${recipeId}/view`, { method: 'POST' })
              .catch(() => {
                // Silently fail - don't show errors to user
              });
            setSent(true);
          }, 600);
        } else if (timeoutId) {
          clearTimeout(timeoutId);
        }
      },
      { threshold: [0.5] }
    );
    
    observer.observe(ref.current);
    
    return () => {
      observer.disconnect();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [recipeId, sent]);

  return ref;
}
