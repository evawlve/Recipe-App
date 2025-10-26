'use client';

import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function TrendingRail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });

  return (
    <div className="relative">
      <button 
        aria-label="Scroll left" 
        onClick={() => scrollBy(-400)} 
        className="hidden md:grid place-items-center absolute left-0 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 shadow ring-1 ring-border z-10"
      >
        <ChevronLeft size={18} />
      </button>
      <div 
        ref={ref} 
        className="flex gap-4 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-4 pr-4"
      >
        {children}
      </div>
      <button 
        aria-label="Scroll right" 
        onClick={() => scrollBy(400)} 
        className="hidden md:grid place-items-center absolute right-0 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-background/80 shadow ring-1 ring-border z-10"
      >
        <ChevronRight size={18} />
      </button>
    </div>
  );
}
