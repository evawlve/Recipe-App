import { NextRequest, NextResponse } from 'next/server';
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from '@sentry/nextjs';

/**
 * Checks if caching should be disabled for this request
 */
export function shouldSkipCache(req: NextRequest | Request): boolean {
  const url = new URL(req.url);
  
  // Skip cache if ?nocache=1 is present
  if (url.searchParams.get('nocache') === '1') {
    return true;
  }
  
  // Skip cache if Authorization/Cookie indicates editing
  // Check for editing indicators: referer from edit pages, or specific editing headers
  const authHeader = req.headers.get('authorization');
  const referer = req.headers.get('referer') || req.headers.get('referrer');
  const cookieHeader = req.headers.get('cookie');
  
  // If there's an authorization header and the referer suggests editing context, skip cache
  if (authHeader && referer) {
    const refererUrl = referer.toLowerCase();
    // Skip cache if request is coming from an edit page
    if (refererUrl.includes('/edit') || refererUrl.includes('/recipes/') && refererUrl.includes('edit')) {
      return true;
    }
  }
  
  // Check for editing-specific cookies or headers
  // If there's a cookie indicating editing mode, skip cache
  if (cookieHeader) {
    const cookies = cookieHeader.toLowerCase();
    // Check for common editing indicators (can be extended)
    if (cookies.includes('editing=true') || cookies.includes('edit_mode=1')) {
      return true;
    }
  }
  
  return false;
}

/**
 * Sets cache headers on a NextResponse
 * @param response - The NextResponse to add headers to
 * @param isUserScoped - If true, adds Vary: Cookie header for user-specific caching
 */
export function setCacheHeaders(response: NextResponse, isUserScoped: boolean = false): NextResponse {
  response.headers.set(
    'Cache-Control',
    'public, s-maxage=60, stale-while-revalidate=300'
  );
  
  // For user-scoped responses, ensure proper cache keying by user
  if (isUserScoped) {
    response.headers.set('Vary', 'Cookie');
  }
  
  return response;
}

/**
 * Wraps a handler function with caching support.
 * Sets HTTP cache headers and adds Sentry breadcrumbs.
 * 
 * @param req - The request object
 * @param cacheKey - The cache key (should include userId for user-scoped responses)
 * @param handler - The handler function that returns a NextResponse
 * @param isUserScoped - Whether this response is user-scoped
 * @returns The NextResponse with cache headers
 */
export async function withCache(
  req: NextRequest | Request,
  cacheKey: string,
  handler: () => Promise<NextResponse>,
  isUserScoped: boolean = false
): Promise<NextResponse> {
  // Check if we should skip caching
  if (shouldSkipCache(req)) {
    // Sentry disabled
    // Sentry.addBreadcrumb({
    //   category: 'cache',
    //   message: 'Cache skipped',
    //   level: 'info',
    //   data: { cacheKey, 'cache.hit': false }
    // });
    const response = await handler();
    return response; // Don't set cache headers when skipping
  }
  
  // Execute handler and set cache headers
  // Note: We can't determine HTTP cache hits/misses from server side,
  // so we log that caching is enabled
  // Sentry disabled
  // Sentry.addBreadcrumb({
  //   category: 'cache',
  //   message: 'Cache enabled',
  //   level: 'info',
  //   data: { cacheKey, 'cache.hit': false } // Server-side generation, cache hit happens at CDN
  // });
  
  const response = await handler();
  return setCacheHeaders(response, isUserScoped);
}

