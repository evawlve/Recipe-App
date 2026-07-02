'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRef, useState, useEffect } from 'react';

const mealType = [
  { label:'Breakfast', slug:'breakfast', image:'/images/cat/breakfast.png' },
  { label:'Lunch',     slug:'lunch',     image:'/images/cat/lunch.png' },
  { label:'Dinner',    slug:'dinner',    image:'/images/cat/dinner.png' },
  { label:'Snacks',    slug:'snack',     image:'/images/cat/snacks.png' },
  { label:'Desserts',  slug:'dessert',   image:'/images/cat/dessert.png' },
  { label:'Drinks',    slug:'drinks',    image:'/images/cat/drinks.png' },
];

const cuisine = [
  { label:'Mexican', slug:'mexican', image:'/images/cat/mexican.png' },
  { label:'Italian', slug:'italian', image:'/images/cat/italian.png' },
  { label:'American',slug:'american',image:'/images/cat/american.png' },
  { label:'Japanese', slug:'japanese', image:'/images/cat/japanese.png' },
  { label:'Greek', slug:'greek', image:'/images/cat/greek.png' },
  { label:'Chinese', slug:'chinese', image:'/images/cat/chinese.png' },
];

function Tile({label,slug,image}:{label:string;slug:string;image:string}) {
  return (
    <Link href={`/recipes?tags=${encodeURIComponent(slug)}`} className="group block">
      <div className="aspect-[16/12] overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
        <Image
          src={image}
          alt={label}
          width={300}
          height={225}
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
        />
      </div>
      <div className="mt-2 text-sm font-medium">{label}</div>
    </Link>
  );
}

function PaginationDots({ scrollRef, itemCount, itemsPerPage }: { 
  scrollRef: React.RefObject<HTMLDivElement | null>; 
  itemCount: number;
  itemsPerPage: number;
}) {
  const [activePage, setActivePage] = useState(0);
  const totalPages = Math.ceil(itemCount / itemsPerPage);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const handleScroll = () => {
      const scrollLeft = element.scrollLeft;
      const scrollWidth = element.scrollWidth;
      const clientWidth = element.clientWidth;
      
      // Calculate which page we're on based on scroll position
      const pageWidth = scrollWidth / totalPages;
      const currentPage = Math.round(scrollLeft / pageWidth);
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

export function ExploreTiles() {
  const categoryMobileRef = useRef<HTMLDivElement>(null);
  const categoryMidRef = useRef<HTMLDivElement>(null);
  const cuisineMobileRef = useRef<HTMLDivElement>(null);
  const cuisineMidRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-base font-semibold">Explore by Category</h3>
        {/* Mobile: Horizontal slider with pagination dots */}
        <div className="md:hidden">
          <div ref={categoryMobileRef} className="overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
            <div className="flex gap-3">
              {mealType.map(t => (
                <div key={t.slug} className="flex-shrink-0" style={{ width: 'calc(33.333% - 8px)' }}>
                  <Tile {...t} />
                </div>
              ))}
            </div>
          </div>
          <PaginationDots scrollRef={categoryMobileRef} itemCount={mealType.length} itemsPerPage={3} />
        </div>
        
        {/* Mid breakpoint: Horizontal slider with pagination dots */}
        <div className="hidden md:block xl:hidden">
          <div ref={categoryMidRef} className="overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
            <div className="flex gap-6">
              {mealType.map(t => (
                <div key={t.slug} className="flex-shrink-0" style={{ width: '180px' }}>
                  <Tile {...t} />
                </div>
              ))}
            </div>
          </div>
          <PaginationDots scrollRef={categoryMidRef} itemCount={mealType.length} itemsPerPage={4} />
        </div>
        
        {/* Desktop: Grid layout (xl and above) */}
        <div className="hidden xl:grid gap-6 grid-cols-6">
          {mealType.map(t => <Tile key={t.slug} {...t} />)}
        </div>
      </div>
      
      <div>
        <h3 className="mb-2 text-base font-semibold">Explore by Cuisine</h3>
        {/* Mobile: Horizontal slider with pagination dots */}
        <div className="md:hidden">
          <div ref={cuisineMobileRef} className="overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
            <div className="flex gap-3">
              {cuisine.map(t => (
                <div key={t.slug} className="flex-shrink-0" style={{ width: 'calc(33.333% - 8px)' }}>
                  <Tile {...t} />
                </div>
              ))}
            </div>
          </div>
          <PaginationDots scrollRef={cuisineMobileRef} itemCount={cuisine.length} itemsPerPage={3} />
        </div>
        
        {/* Mid breakpoint: Horizontal slider with pagination dots */}
        <div className="hidden md:block xl:hidden">
          <div ref={cuisineMidRef} className="overflow-x-auto no-scrollbar -mx-4 px-4 pb-2">
            <div className="flex gap-6">
              {cuisine.map(t => (
                <div key={t.slug} className="flex-shrink-0" style={{ width: '180px' }}>
                  <Tile {...t} />
                </div>
              ))}
            </div>
          </div>
          <PaginationDots scrollRef={cuisineMidRef} itemCount={cuisine.length} itemsPerPage={4} />
        </div>
        
        {/* Desktop: Grid layout (xl and above) */}
        <div className="hidden xl:grid gap-6 grid-cols-6">
          {cuisine.map(t => <Tile key={t.slug} {...t} />)}
        </div>
      </div>
    </div>
  );
}
