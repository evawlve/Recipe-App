/**
 * Rate limiter specifically for authentication endpoints
 * Tracks failed login attempts and implements progressive delays
 */

interface FailedAttempt {
  count: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  lockedUntil?: number;
}

class AuthRateLimiter {
  private failedAttempts = new Map<string, FailedAttempt>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  // Configuration
  private readonly MAX_ATTEMPTS = 5;
  private readonly LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
  private readonly ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private readonly PROGRESSIVE_DELAY_MS = [0, 1000, 2000, 5000, 10000]; // Delays for each attempt

  constructor() {
    // Clean up expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, attempt] of this.failedAttempts.entries()) {
        // Remove if window expired or lockout expired
        if (
          attempt.lastAttemptAt + this.ATTEMPT_WINDOW_MS < now &&
          (!attempt.lockedUntil || attempt.lockedUntil < now)
        ) {
          this.failedAttempts.delete(key);
        }
      }
    }, 5 * 60 * 1000);
  }

  /**
   * Check if an identifier is currently locked out
   */
  isLockedOut(identifier: string): { locked: boolean; unlockAt?: number; remainingMs?: number } {
    const attempt = this.failedAttempts.get(identifier);
    
    if (!attempt || !attempt.lockedUntil) {
      return { locked: false };
    }

    const now = Date.now();
    if (attempt.lockedUntil > now) {
      return {
        locked: true,
        unlockAt: attempt.lockedUntil,
        remainingMs: attempt.lockedUntil - now,
      };
    }

    // Lockout expired
    this.failedAttempts.delete(identifier);
    return { locked: false };
  }

  /**
   * Record a failed authentication attempt
   */
  recordFailedAttempt(identifier: string): {
    locked: boolean;
    lockedUntil?: number;
    attemptsRemaining: number;
    requiresDelay: boolean;
    delayMs: number;
  } {
    const now = Date.now();
    const existing = this.failedAttempts.get(identifier);

    let attempt: FailedAttempt;

    if (!existing || existing.lastAttemptAt + this.ATTEMPT_WINDOW_MS < now) {
      // First attempt or window expired - start fresh
      attempt = {
        count: 1,
        firstAttemptAt: now,
        lastAttemptAt: now,
      };
    } else {
      // Increment existing attempt
      attempt = {
        ...existing,
        count: existing.count + 1,
        lastAttemptAt: now,
      };
    }

    // Check if should lock out
    if (attempt.count >= this.MAX_ATTEMPTS) {
      attempt.lockedUntil = now + this.LOCKOUT_DURATION_MS;
      this.failedAttempts.set(identifier, attempt);
      
      return {
        locked: true,
        lockedUntil: attempt.lockedUntil,
        attemptsRemaining: 0,
        requiresDelay: false,
        delayMs: 0,
      };
    }

    this.failedAttempts.set(identifier, attempt);

    // Calculate progressive delay
    const delayIndex = Math.min(attempt.count - 1, this.PROGRESSIVE_DELAY_MS.length - 1);
    const delayMs = this.PROGRESSIVE_DELAY_MS[delayIndex];

    return {
      locked: false,
      attemptsRemaining: this.MAX_ATTEMPTS - attempt.count,
      requiresDelay: delayMs > 0,
      delayMs,
    };
  }

  /**
   * Clear failed attempts for an identifier (after successful login)
   */
  clearAttempts(identifier: string): void {
    this.failedAttempts.delete(identifier);
  }

  /**
   * Get current attempt info for an identifier
   */
  getAttemptInfo(identifier: string): {
    attempts: number;
    attemptsRemaining: number;
    lockedUntil?: number;
  } {
    const lockStatus = this.isLockedOut(identifier);
    if (lockStatus.locked) {
      return {
        attempts: this.MAX_ATTEMPTS,
        attemptsRemaining: 0,
        lockedUntil: lockStatus.unlockAt,
      };
    }

    const attempt = this.failedAttempts.get(identifier);
    if (!attempt) {
      return {
        attempts: 0,
        attemptsRemaining: this.MAX_ATTEMPTS,
      };
    }

    const now = Date.now();
    // Check if window expired
    if (attempt.lastAttemptAt + this.ATTEMPT_WINDOW_MS < now) {
      this.failedAttempts.delete(identifier);
      return {
        attempts: 0,
        attemptsRemaining: this.MAX_ATTEMPTS,
      };
    }

    return {
      attempts: attempt.count,
      attemptsRemaining: this.MAX_ATTEMPTS - attempt.count,
    };
  }

  /**
   * Clean up and destroy the rate limiter
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.failedAttempts.clear();
  }
}

// Create singleton instance
const authRateLimiter = new AuthRateLimiter();

export default authRateLimiter;

