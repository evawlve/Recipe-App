'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const handleSearch = () => {
    if (query.trim()) {
      router.push(`/recipes?search=${encodeURIComponent(query.trim())}`);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-search-bg border border-border">
      <Search className="h-4 w-4 text-search-placeholder" />
      <input 
        placeholder="Search recipes" 
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyPress={handleKeyPress}
        className="w-full bg-transparent text-search-text text-sm border-0 outline-0 focus:border-0 focus:outline-0 focus:ring-0 placeholder:text-search-placeholder" 
      />
      <Button 
        onClick={handleSearch}
        size="sm"
        disabled={!query.trim()}
        className="shrink-0 h-7 px-2 text-xs"
      >
        Search
      </Button>
    </div>
  );
}
