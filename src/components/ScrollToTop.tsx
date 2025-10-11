"use client";

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export function ScrollToTop() {
  const searchParams = useSearchParams();
  
  useEffect(() => {
    // Check if this is a new user redirect (from signup)
    const isNewUser = searchParams.get('newUser') === 'true';
    const isVerified = searchParams.get('verified') === 'true';
    
    // Always scroll to top when the page loads
    // This is especially important after account creation
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
    
    // If this is a new user, also clear any URL parameters after scrolling
    if (isNewUser || isVerified) {
      // Clean up the URL by removing the parameters
      const url = new URL(window.location.href);
      url.searchParams.delete('newUser');
      url.searchParams.delete('verified');
      url.searchParams.delete('email');
      
      // Replace the URL without the parameters
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [searchParams]);

  return null; // This component doesn't render anything
}
