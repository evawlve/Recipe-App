import { NextResponse } from 'next/server';
import { rateLimit, getClientIp } from './rate-limit';

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  identifier?: string; // Optional custom identifier
}

/**
 * Middleware helper to apply rate limiting to API routes
 * 
 * Usage:
 * ```typescript
 * export async function POST(request: Request) {
 *   const rateLimitResult = await withRateLimit(request, {
 *     limit: 5,
 *     windowMs: 15 * 60 * 1000,
 *   });
 *   
 *   if (!rateLimitResult.success) {
 *     return rateLimitResult.response;
 *   }
 *   
 *   // Continue with your logic
 * }
 * ```
 */
export async function withRateLimit(
  request: Request,
  config: RateLimitConfig
): Promise<{
  success: boolean;
  response?: NextResponse;
  remaining?: number;
  resetAt?: number;
}> {
  const identifier = config.identifier || getClientIp(request);
  const result = rateLimit(identifier, {
    limit: config.limit,
    windowMs: config.windowMs,
  });

  if (!result.success) {
    const resetDate = new Date(result.resetAt);
    const retryAfterSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
    
    return {
      success: false,
      response: NextResponse.json(
        {
          error: 'Too many requests',
          message: 'You have exceeded the rate limit. Please try again later.',
          retryAfter: retryAfterSeconds,
          resetAt: resetDate.toISOString(),
        },
        {
          status: 429,
          headers: {
            'Retry-After': retryAfterSeconds.toString(),
            'X-RateLimit-Limit': config.limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': resetDate.toISOString(),
          },
        }
      ),
    };
  }

  return {
    success: true,
    remaining: result.remaining,
    resetAt: result.resetAt,
  };
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  response: NextResponse,
  limit: number,
  remaining: number,
  resetAt: number
): NextResponse {
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(resetAt).toISOString());
  return response;
}

