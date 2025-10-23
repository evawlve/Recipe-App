import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // During build time, return a mock client to avoid build failures
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // Return a mock client during build
      return {
        auth: {
          getUser: () => Promise.resolve({ data: { user: null }, error: null }),
          signOut: () => Promise.resolve({ error: null }),
          resetPasswordForEmail: () => Promise.resolve({ error: null }),
          signInWithPassword: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
          signUp: () => Promise.resolve({ data: { user: null, session: null }, error: null }),
          signInWithOAuth: () => Promise.resolve({ data: { url: null }, error: null }),
          onAuthStateChange: (callback: (event: any, session: any) => void) => ({ data: { subscription: { unsubscribe: () => {} } } }),
        },
      } as any;
    }
    throw new Error(
      'Missing Supabase environment variables. Please add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your .env file.'
    );
  }
  
  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce'
    }
  });
}
