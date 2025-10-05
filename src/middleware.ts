import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Define protected routes
  const protectedRoutes = [
    '/recipes/new',
    '/recipes/[id]/edit',
    '/recipes/[id]/delete'
  ];
  
  // Check if current path is protected
  const isProtectedRoute = protectedRoutes.some(route => {
    if (route.includes('[id]')) {
      // Handle dynamic routes like /recipes/[id]/edit
      return pathname.match(/^\/recipes\/[^\/]+\/(edit|delete)$/);
    }
    return pathname === route;
  });
  
  if (isProtectedRoute) {
    try {
      const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            get(name: string) {
              return request.cookies.get(name)?.value;
            },
            set(name: string, value: string, options: any) {
              request.cookies.set({ name, value, ...options });
            },
            remove(name: string, options: any) {
              request.cookies.set({ name, value: '', ...options });
            },
          },
        }
      );
      
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        // Redirect to signin page
        const signInUrl = new URL('/signin', request.url);
        signInUrl.searchParams.set('redirectTo', pathname);
        return NextResponse.redirect(signInUrl);
      }
    } catch (error) {
      // If there's an error checking auth, redirect to signin
      const signInUrl = new URL('/signin', request.url);
      signInUrl.searchParams.set('redirectTo', pathname);
      return NextResponse.redirect(signInUrl);
    }
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: [
    '/recipes/new',
    '/recipes/:path*/(edit|delete)',
  ],
};
