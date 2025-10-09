import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Clears all authentication data and redirects to sign in
 * Use this when there are token-related errors
 */
export async function clearAuthAndRedirect() {
  try {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    
    // Clear any local storage items
    if (typeof window !== 'undefined') {
      localStorage.removeItem('sb-' + process.env.NEXT_PUBLIC_SUPABASE_URL?.split('//')[1]?.split('.')[0] + '-auth-token');
    }
    
    // Redirect to sign in
    window.location.href = '/signin';
  } catch (error) {
    console.error('Error clearing auth:', error);
    // Force redirect even if clearing fails
    window.location.href = '/signin';
  }
}

/**
 * Checks if an error is related to invalid tokens
 */
export function isTokenError(error: any): boolean {
  const message = error?.message || '';
  return message.includes('Invalid Refresh Token') || 
         message.includes('Refresh Token Not Found') ||
         message.includes('JWT expired') ||
         message.includes('Invalid JWT');
}
