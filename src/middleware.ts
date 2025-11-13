import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { nanoid } from 'nanoid';

export async function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  
  // Handle OAuth callback at root route - rewrite to callback route handler
  // This is necessary because Supabase redirects to / instead of /auth/callback
  if (pathname === '/' && searchParams.has('code')) {
    // Rewrite the request to the callback route handler with all parameters
    const callbackUrl = new URL('/auth/callback', request.url);
    // Copy all search parameters
    searchParams.forEach((value, key) => {
      callbackUrl.searchParams.set(key, value);
    });
    
    const rewriteResponse = NextResponse.rewrite(callbackUrl);
    addSecurityHeaders(rewriteResponse);
    return rewriteResponse;
  }
  
  // Create response (will be modified with security headers)
  let response: NextResponse;
  
  // Bypass API and static assets
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/static') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/auth')
  ) {
    response = NextResponse.next();
    // Add security headers and return early
    addSecurityHeaders(response);
    return response;
  }
  
  // Handle session cookie for anonymous tracking
  response = NextResponse.next();
  const hasSession = request.cookies.get('ms_session');
  
  if (!hasSession) {
    response.cookies.set('ms_session', nanoid(), { 
      httpOnly: true, 
      sameSite: 'lax', 
      maxAge: 60 * 60 * 24 * 365, // 1 year
      secure: process.env.NODE_ENV === 'production', // Secure in production
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
        const redirectResponse = NextResponse.redirect(signInUrl);
        addSecurityHeaders(redirectResponse);
        return redirectResponse;
      }
    } catch (error) {
      // If there's an error checking auth, redirect to signin
      const signInUrl = new URL('/signin', request.url);
      signInUrl.searchParams.set('redirectTo', pathname);
      const redirectResponse = NextResponse.redirect(signInUrl);
      addSecurityHeaders(redirectResponse);
      return redirectResponse;
    }
  }
  
  // Add security headers to all responses
  addSecurityHeaders(response);
  return response;
}

/**
 * Add security headers to response
 * These headers help protect against common web vulnerabilities
 */
function addSecurityHeaders(response: NextResponse): void {
  // Prevent clickjacking attacks
  response.headers.set('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy - don't leak URLs to external sites
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy - restrict browser features
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  );
  
  // Content Security Policy - defense in depth
  // Note: Adjust this based on your needs (e.g., if you use external scripts/styles)
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requires unsafe-eval/inline
    "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
    "img-src 'self' data: https: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.amazonaws.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  response.headers.set('Content-Security-Policy', cspDirectives);
  
  // Strict-Transport-Security - force HTTPS (only in production)
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload'
    );
  }
}

export const config = {
  matcher: [
    '/(.*)'
  ],
};
