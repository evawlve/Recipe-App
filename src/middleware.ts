import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { nanoid } from 'nanoid';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  
  // Bypass API and static assets
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/static') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/auth')
  ) {
    return NextResponse.next();
  }
  
  // Handle session cookie for anonymous tracking
  const response = NextResponse.next();
  const hasSession = request.cookies.get('ms_session');
  
  if (!hasSession) {
    response.cookies.set('ms_session', nanoid(), { 
      httpOnly: true, 
      sameSite: 'lax', 
      maxAge: 60 * 60 * 24 * 365 // 1 year
    });
  }
  
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
  
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
