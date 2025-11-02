'use client';

import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

function PaginationDots({ scrollRef, itemCount, itemWidth }: { 
  scrollRef: React.RefObject<HTMLDivElement | null>; 
  itemCount: number;
  itemWidth: number;
}) {
  const [activePage, setActivePage] = useState(0);
  
  // Calculate how many items fit per page based on viewport
  const [itemsPerPage, setItemsPerPage] = useState(3);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateItemsPerPage = () => {
      const containerWidth = element.clientWidth;
      const calculatedItems = Math.floor(containerWidth / itemWidth);
      setItemsPerPage(Math.max(1, calculatedItems));
    };

    updateItemsPerPage();
    window.addEventListener('resize', updateItemsPerPage);

    return () => window.removeEventListener('resize', updateItemsPerPage);
  }, [scrollRef, itemWidth]);

  const totalPages = Math.ceil(itemCount / itemsPerPage);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      const scrollLeft = element.scrollLeft;
      const scrollWidth = element.scrollWidth - element.clientWidth;
      
      if (scrollWidth === 0) {
        setActivePage(0);
        return;
      }
      
      // Calculate which page we're on based on scroll position
      const scrollProgress = scrollLeft / scrollWidth;
      const currentPage = Math.round(scrollProgress * (totalPages - 1));
      setActivePage(Math.min(currentPage, totalPages - 1));
    };

    element.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial check

    return () => element.removeEventListener('scroll', handleScroll);
  }, [scrollRef, totalPages]);

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center gap-1.5 mt-3">
      {Array.from({ length: totalPages }).map((_, index) => (
        <div
          key={index}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            index === activePage 
              ? 'w-6 bg-primary' 
              : 'w-1.5 bg-muted-foreground/30'
          }`}
        />
      ))}
    </div>
  );
}

export function TrendingRail({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scrollBy = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });
  
  // Count children for pagination
  const childCount = Array.isArray(children) ? children.length : children ? 1 : 0;
  // Average card width including gap (280-320px card + 16px gap)
  const avgItemWidth = 316;

  return (
    <div>
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
      <PaginationDots scrollRef={ref} itemCount={childCount} itemWidth={avgItemWidth} />
    </div>
  );
}
