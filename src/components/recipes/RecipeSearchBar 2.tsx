'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RecipeSearchBar() {
  const [query, setQuery] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initialize query from URL params
  useEffect(() => {
    const searchParam = searchParams.get('search');
    if (searchParam) {
      setQuery(searchParam);
    }
  }, [searchParams]);

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (query.trim()) {
      params.set('search', query.trim());
    } else {
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
    params.delete('search');
    params.delete('cursor');
    router.push(`/recipes?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 rounded-lg bg-search-bg border border-border px-3 py-2">
      <Search className="h-4 w-4 text-search-placeholder" />
      <input 
        placeholder="Search recipes..." 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={handleKeyPress}
        className="w-full bg-transparent text-search-text text-sm border-0 outline-0 focus:border-0 focus:outline-0 focus:ring-0 placeholder:text-search-placeholder" 
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
