'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Search, User } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';

interface SearchSuggestion {
  label: string;
  q: string;
  support?: string;
}

interface UserSuggestion {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarKey: string | null;
  followerCount: number;
}

interface SearchBoxProps {
  className?: string;
}

export function SearchBox({ className }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{
    searches: SearchSuggestion[];
    users: UserSuggestion[];
  }>({ searches: [], users: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Fetch suggestions from the new suggest API
  const fetchSuggestions = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim() || searchTerm.length < 2) {
      setSuggestions({ searches: [], users: [] });
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/search/suggest?q=${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const data = await response.json();
        setSuggestions({
          searches: data.searches || [],
          users: data.users || [],
        });
        setIsOpen(true);
        setSelectedIndex(0);
      }
    } catch (error) {
      console.error('Error fetching suggestions:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);

      // Clear previous debounce
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      // Debounce search (150-200ms as specified)
      debounceRef.current = setTimeout(() => {
        fetchSuggestions(value);
      }, 175);
    },
    [fetchSuggestions]
  );

  const navigateToSearch = useCallback(
    (searchQuery: string) => {
      router.push(`/recipes?q=${encodeURIComponent(searchQuery)}`);
      setIsOpen(false);
      setQuery('');
    },
    [router]
  );

  const navigateToUser = useCallback(
    (username: string) => {
      router.push(`/u/${username}`);
      setIsOpen(false);
      setQuery('');
    },
    [router]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        navigateToSearch(query.trim());
      }
    },
    [query, navigateToSearch]
  );

  // Calculate total items for keyboard navigation
  const totalItems = suggestions.searches.length + suggestions.users.length + 1; // +1 for "Search for" row

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          setIsOpen(false);
          setSelectedIndex(0);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % totalItems);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex === 0) {
            // Top "Search for '...'" row
            navigateToSearch(query.trim());
          } else if (selectedIndex <= suggestions.searches.length) {
            // Recipe search suggestions
            const search = suggestions.searches[selectedIndex - 1];
            navigateToSearch(search.q);
          } else {
            // User suggestions
            const userIndex = selectedIndex - suggestions.searches.length - 1;
            const user = suggestions.users[userIndex];
            if (user?.username) {
              navigateToUser(user.username);
            }
          }
          break;
      }
    },
    [isOpen, selectedIndex, totalItems, suggestions, query, navigateToSearch, navigateToUser]
  );

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSelectedIndex(0);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasSuggestions = suggestions.searches.length > 0 || suggestions.users.length > 0;

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-search-placeholder h-4 w-4" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search recipes and people..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
            className={`pl-10 pr-4 py-2 bg-search-bg border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent text-search-text placeholder:text-search-placeholder ${
              className?.includes('w-full') ? 'w-full' : 'w-64'
            }`}
          />
        </div>
      </form>

      {/* Suggestions Popover */}
      {isOpen && (hasSuggestions || isLoading || query.trim()) && (
        <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-[32rem] overflow-y-auto shadow-lg">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                <div className="flex items-center justify-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                  <span>Searching...</span>
                </div>
              </div>
            ) : (
              <>
                {/* Top "Search for '...'" row */}
                {query.trim() && (
                  <div className="border-b border-border">
                    <button
                      onClick={() => navigateToSearch(query.trim())}
                      className={`w-full px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                        selectedIndex === 0
                          ? 'bg-muted/70 text-foreground'
                          : 'hover:bg-muted/50 text-muted-foreground'
                      }`}
                    >
                      <Search className="h-4 w-4" />
                      <span className="font-medium">
                        Search for <span className="text-foreground">"{query}"</span>
                      </span>
                    </button>
                  </div>
                )}

                {/* Searches (Recipes) Section */}
                {suggestions.searches.length > 0 && (
                  <div className="border-b border-border">
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      Searches
                    </div>
                    {suggestions.searches.map((search, index) => {
                      const itemIndex = index + 1;
                      return (
                        <button
                          key={`search-${index}`}
                          onClick={() => navigateToSearch(search.q)}
                          className={`w-full px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                            selectedIndex === itemIndex
                              ? 'bg-muted/70'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{search.label}</div>
                            {search.support && (
                              <div className="text-xs text-muted-foreground truncate">
                                {search.support}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Accounts (Users) Section */}
                {suggestions.users.length > 0 && (
                  <div>
                    <div className="px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider bg-muted/30">
                      Accounts
                    </div>
                    {suggestions.users.map((user, index) => {
                      const itemIndex = suggestions.searches.length + 1 + index;
                      return (
                        <button
                          key={`user-${user.id}`}
                          onClick={() => user.username && navigateToUser(user.username)}
                          className={`w-full px-4 py-3 text-left transition-colors flex items-center gap-3 ${
                            selectedIndex === itemIndex
                              ? 'bg-muted/70'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <div className="relative w-8 h-8 rounded-full overflow-hidden bg-muted flex-shrink-0">
                            {user.avatarKey ? (
                              <Image
                                src={`/api/image/${user.avatarKey}`}
                                alt={`${user.displayName || user.username} avatar`}
                                fill
                                className="object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary">
                                {(user.displayName || user.username || 'U')
                                  .charAt(0)
                                  .toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">
                              {user.displayName || user.username}
                            </div>
                            <div className="text-sm text-muted-foreground truncate">
                              @{user.username}
                              {user.followerCount > 0 && (
                                <span className="ml-2">· {user.followerCount} followers</span>
                              )}
                            </div>
                          </div>
                          <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* No results message */}
                {!isLoading && !hasSuggestions && query.trim().length >= 2 && (
                  <div className="p-4 text-center text-muted-foreground">
                    <p className="text-sm">No results found</p>
                    <button
                      onClick={() => navigateToSearch(query.trim())}
                      className="mt-2 text-sm text-primary hover:underline"
                    >
                      Search for "{query}" anyway
                    </button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

