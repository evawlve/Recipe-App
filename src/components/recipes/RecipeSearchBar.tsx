'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RecipeSearchBar() {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize query from URL params (support both 'q' and 'search')
  useEffect(() => {
    const qParam = searchParams.get('q');
    const searchParam = searchParams.get('search');
    if (qParam) {
      setQuery(qParam);
    } else if (searchParam) {
      setQuery(searchParam);
    }
  }, [searchParams]);

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (query.trim()) {
      params.set('q', query.trim());
      // Remove old 'search' param if it exists
      params.delete('search');
    } else {
      params.delete('q');
      params.delete('search');
    }
    
    // Remove cursor for new search
    params.delete('cursor');
    
    router.push(`/recipes?${params.toString()}`);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const clearSearch = () => {
    setQuery('');
    const params = new URLSearchParams(searchParams.toString());
    params.delete('q');
    params.delete('search');
    params.delete('cursor');
    router.push(`/recipes?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
      <Search className="h-4 w-4 text-muted-foreground" />
      <input 
        placeholder="Search recipes..." 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={handleKeyPress}
        className="w-full bg-transparent outline-none text-sm" 
      />
      {query && (
        <Button 
          onClick={clearSearch}
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
        >
          ×
        </Button>
      )}
      <Button 
        onClick={handleSearch}
        size="sm"
        disabled={!query.trim()}
        className="shrink-0 h-7 px-3 text-xs"
      >
        Search
      </Button>
    </div>
  );
}
