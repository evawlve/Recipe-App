'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, User, ChefHat } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';

interface UserSuggestion {
  id: string;
  username: string;
  displayName: string;
  avatarKey?: string;
}

interface RecipeSuggestion {
  id: string;
  title: string;
  author: {
    id: string;
    username: string;
    displayName: string;
    avatarKey?: string;
  };
  photos: Array<{
    s3Key: string;
    width: number;
    height: number;
  }>;
}

interface EnhancedSearchBoxProps {
  className?: string;
}

export function EnhancedSearchBox({ className }: EnhancedSearchBoxProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<{
    users: UserSuggestion[];
    recipes: RecipeSuggestion[];
  }>({ users: [], recipes: [] });
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const searchUsers = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setSuggestions({ users: [], recipes: [] });
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const users = await response.json();
        setSuggestions(prev => ({ ...prev, users }));
      }
    } catch (error) {
      console.error('Error searching users:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Debounce search
    debounceRef.current = setTimeout(() => {
      searchUsers(value);
    }, 200);
  }, [searchUsers]);

  const handleUserClick = useCallback((user: UserSuggestion) => {
    router.push(`/u/${user.username}`);
    setIsOpen(false);
    setQuery('');
  }, [router]);

  const handleRecipeClick = useCallback((recipe: RecipeSuggestion) => {
    router.push(`/recipes/${recipe.id}`);
    setIsOpen(false);
    setQuery('');
  }, [router]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // For now, just search recipes
      router.push(`/recipes?q=${encodeURIComponent(query.trim())}`);
      setIsOpen(false);
      setQuery('');
    }
  }, [query, router]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const hasSuggestions = suggestions.users.length > 0;

  return (
    <div className={`relative ${className}`} ref={inputRef}>
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="Search users..."
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsOpen(true)}
            className="pl-10 pr-4 py-2 w-64 bg-muted border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>
      </form>

      {/* Suggestions Dropdown */}
      {isOpen && (hasSuggestions || isLoading) && (
        <Card className="absolute top-full left-0 right-0 mt-2 z-50 max-h-96 overflow-y-auto">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 text-center text-muted-foreground">
                Searching...
              </div>
            ) : (
              <>
                {suggestions.users.length > 0 && (
                  <div className="border-b border-border">
                    <div className="px-4 py-2 text-sm font-medium text-muted-foreground bg-muted/50">
                      Users
                    </div>
                    {suggestions.users.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleUserClick(user)}
                        className="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors flex items-center gap-3"
                      >
                        <div className="relative w-8 h-8 rounded-full overflow-hidden bg-gray-100">
                          {user.avatarKey ? (
                            <Image
                              src={`/api/image/${user.avatarKey}`}
                              alt={`${user.displayName || user.username} avatar`}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-green-100 flex items-center justify-center text-sm font-bold text-green-600">
                              {(user.displayName || user.username).charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{user.displayName || user.username}</span>
                            <span className="text-sm text-muted-foreground">@{user.username}</span>
                          </div>
                        </div>
                        <User className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
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
