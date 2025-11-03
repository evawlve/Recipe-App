/**
 * Simple in-memory rate limiter
 * For production with multiple instances, consider using Redis or Upstash
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private storage = new Map<string, RateLimitEntry>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.storage.entries()) {
        if (entry.resetAt < now) {
          this.storage.delete(key);
        }
      }
    }, 60000);
  }

  /**
   * Check if a request should be rate limited
   * @param identifier - Unique identifier (e.g., IP address or user ID)
   * @param limit - Maximum number of requests allowed in the window
   * @param windowMs - Time window in milliseconds
   * @returns Object with success status and remaining attempts
   */
  check(
    identifier: string,
    limit: number,
    windowMs: number
  ): { success: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const entry = this.storage.get(identifier);

    if (!entry || entry.resetAt < now) {
      // First request or window expired
      const resetAt = now + windowMs;
      this.storage.set(identifier, { count: 1, resetAt });
      return { success: true, remaining: limit - 1, resetAt };
    }

    if (entry.count >= limit) {
      // Rate limit exceeded
      return { success: false, remaining: 0, resetAt: entry.resetAt };
    }

    // Increment count
    entry.count++;
    this.storage.set(identifier, entry);
    return { success: true, remaining: limit - entry.count, resetAt: entry.resetAt };
  }

  /**
   * Reset rate limit for a specific identifier
   */
  reset(identifier: string): void {
    this.storage.delete(identifier);
  }

  /**
   * Clean up and stop the rate limiter
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.storage.clear();
  }
}

// Create singleton instance
const rateLimiter = new RateLimiter();

// Export rate limit presets
export const RATE_LIMITS = {
  // Auth endpoints - strict limits
  AUTH_SIGNIN: { limit: 5, windowMs: 15 * 60 * 1000 }, // 5 attempts per 15 minutes
  AUTH_SIGNUP: { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 attempts per hour
  AUTH_PASSWORD_RESET: { limit: 3, windowMs: 60 * 60 * 1000 }, // 3 attempts per hour
  
  // API endpoints - moderate limits
  API_GENERAL: { limit: 100, windowMs: 60 * 1000 }, // 100 requests per minute
  API_UPLOAD: { limit: 10, windowMs: 60 * 1000 }, // 10 uploads per minute
};

/**
 * Get client IP address from request headers
 */
export function getClientIp(request: Request): string {
  // Try various headers used by reverse proxies
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }

  // Fallback to generic identifier
  return 'unknown';
}

/**
 * Apply rate limiting to a request
 */
export function rateLimit(
  identifier: string,
  config: { limit: number; windowMs: number }
): { success: boolean; remaining: number; resetAt: number } {
  return rateLimiter.check(identifier, config.limit, config.windowMs);
}

/**
 * Reset rate limit for an identifier
 */
export function resetRateLimit(identifier: string): void {
  rateLimiter.reset(identifier);
}

export default rateLimiter;

