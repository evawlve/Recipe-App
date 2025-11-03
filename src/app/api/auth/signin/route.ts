import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import authRateLimiter from '@/lib/auth/auth-rate-limiter';
import { getClientIp } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';

const signinSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  
  // Check if IP is locked out
  const lockStatus = authRateLimiter.isLockedOut(ip);
  if (lockStatus.locked) {
    const remainingSeconds = Math.ceil((lockStatus.remainingMs || 0) / 1000);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);
    
    return NextResponse.json(
      {
        error: 'Too many failed login attempts',
        message: `Account temporarily locked. Please try again in ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}.`,
        lockedUntil: lockStatus.unlockAt,
        retryAfter: remainingSeconds,
      },
      {
        status: 429,
        headers: {
          'Retry-After': remainingSeconds.toString(),
        },
      }
    );
  }

  try {
    const body = await request.json();
    const { email, password } = signinSchema.parse(body);

    // Create Supabase client for server-side auth
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Record failed attempt
      const attemptResult = authRateLimiter.recordFailedAttempt(ip);
      
      return NextResponse.json(
        {
          error: 'Authentication failed',
          message: 'Incorrect email or password',
          attemptsRemaining: attemptResult.attemptsRemaining,
        },
        { status: 401 }
      );
    }

    // Success - clear any failed attempts
    authRateLimiter.clearAttempts(ip);

    return NextResponse.json({
      success: true,
      session: data.session,
      user: data.user,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: 'Invalid input',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    console.error('Signin error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Get current rate limit status for the client
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const info = authRateLimiter.getAttemptInfo(ip);
  
  return NextResponse.json({
    attempts: info.attempts,
    attemptsRemaining: info.attemptsRemaining,
    lockedUntil: info.lockedUntil,
  });
}

