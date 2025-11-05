import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createSupabaseServerClient() {
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
        cookies: {
          get: () => undefined,
          set: () => {},
          remove: () => {},
        },
      } as any;
    }
    throw new Error('Missing Supabase environment variables');
  }
  try {
    const cookieStore = await cookies();
    // We cannot reliably detect Route Handler/Server Action at runtime.
    // To avoid runtime errors in Server Components, default cookie mutations to no-ops here.
    const safeSetCookie = (_name: string, _value: string, _options: any) => {
      try {
        // Attempt to set when allowed (Route Handler/Server Action). If not allowed, this will throw and be ignored.
        // @ts-ignore - runtime guard
        cookieStore.set?.({ name: _name, value: _value, ..._options });
      } catch (_err) {
        // swallow
      }
    };
    const safeRemoveCookie = (_name: string, _options: any) => {
      try {
        // @ts-ignore - runtime guard
        cookieStore.set?.({ name: _name, value: '', ..._options });
      } catch (_err) {
        // swallow
      }
    };

    return createServerClient(supabaseUrl!, supabaseAnonKey!, {
      cookies: {
        get(name: string) {
          try {
            return cookieStore.get(name)?.value;
          } catch (error) {
            console.error('Error getting cookie:', name, error);
            return undefined;
          }
        },
        set(name: string, value: string, options: any) { safeSetCookie(name, value, options); },
        remove(name: string, options: any) { safeRemoveCookie(name, options); },
      },
    });
  } catch (error) {
    console.error('Error creating Supabase server client:', error);
    // Fallback: create client without cookies
    return createServerClient(supabaseUrl!, supabaseAnonKey!, {
      cookies: {
        get() { return undefined; },
        set() { },
        remove() { },
      },
    });
  }
}
