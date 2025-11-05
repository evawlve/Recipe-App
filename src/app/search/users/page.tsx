import { Suspense } from 'react';
import { UserSearchClient } from './UserSearchClient';
import { getCurrentUser } from '@/lib/auth';

interface UserSearchPageProps {
  searchParams: Promise<{
    q?: string;
  }>;
}

export default async function UserSearchPage({ searchParams }: UserSearchPageProps) {
  const resolvedSearchParams = await searchParams;
  const searchQuery = resolvedSearchParams.q || '';
  
  // Get current user for follow functionality
  const currentUser = await getCurrentUser();

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">Search Users</h1>
          <p className="text-muted-foreground">
            Find and connect with other food enthusiasts
          </p>
        </div>

        <Suspense fallback={<div className="text-center py-8">Loading...</div>}>
          <UserSearchClient 
            initialQuery={searchQuery}
            currentUser={currentUser}
          />
        </Suspense>
      </div>
    </div>
  );
}
