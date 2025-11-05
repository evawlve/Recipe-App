'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Search, User, Users, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { FollowButton } from '@/components/account/FollowButton';

interface UserSearchResult {
  id: string;
  username: string;
  displayName: string;
  avatarKey?: string;
}

interface UserSearchClientProps {
  initialQuery: string;
  currentUser: {
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  } | null;
}

export function UserSearchClient({ initialQuery, currentUser }: UserSearchClientProps) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(!!initialQuery);
  const router = useRouter();
  const searchParams = useSearchParams();

  const searchUsers = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/users/search?q=${encodeURIComponent(searchTerm)}`);
      if (response.ok) {
        const users = await response.json();
        setResults(users);
        setHasSearched(true);
      }
    } catch (error) {
      console.error('Error searching users:', error);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      // Update URL with search query
      const params = new URLSearchParams(searchParams.toString());
      params.set('q', query.trim());
      router.push(`/search/users?${params.toString()}`);
      
      // Perform search
      searchUsers(query.trim());
    }
  }, [query, router, searchParams, searchUsers]);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    router.push('/search/users');
  }, [router]);

  // Perform initial search if there's a query
  useEffect(() => {
    if (initialQuery) {
      searchUsers(initialQuery);
    }
  }, [initialQuery, searchUsers]);

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search by username or display name..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button type="submit" disabled={!query.trim() || isLoading}>
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  'Search'
                )}
              </Button>
              {query && (
                <Button type="button" variant="outline" onClick={handleClear}>
                  Clear
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Search Results */}
      {hasSearched && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Users className="h-5 w-5" />
            <span className="text-sm">
              {isLoading ? 'Searching...' : `${results.length} user${results.length !== 1 ? 's' : ''} found`}
              {query && ` for "${query}"`}
            </span>
          </div>

          {isLoading ? (
            <div className="text-center py-8">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">Searching users...</p>
            </div>
          ) : results.length > 0 ? (
            <div className="grid gap-4">
              {results.map((user) => (
                <Card key={user.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gray-100">
                          {user.avatarKey ? (
                            <Image
                              src={`/api/image/${user.avatarKey}`}
                              alt={`${user.displayName || user.username} avatar`}
                              fill
                              className="object-cover"
                            />
                          ) : (
                            <div className="w-full h-full bg-green-100 flex items-center justify-center text-lg font-bold text-green-600">
                              {(user.displayName || user.username).charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">
                            {user.displayName || user.username}
                          </h3>
                          <p className="text-muted-foreground">@{user.username}</p>
                        </div>
                      </div>
                      
                      {currentUser && currentUser.id !== user.id && (
                        <FollowButton userId={user.id} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <User className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No users found</h3>
                <p className="text-muted-foreground">
                  Try searching with a different username or display name.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Empty State */}
      {!hasSearched && !isLoading && (
        <Card>
          <CardContent className="p-8 text-center">
            <Search className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">Search for Users</h3>
            <p className="text-muted-foreground">
              Enter a username or display name to find other food enthusiasts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
