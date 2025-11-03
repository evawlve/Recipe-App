import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { withRateLimit } from '@/lib/auth/with-rate-limit';
import { RATE_LIMITS } from '@/lib/auth/rate-limit';

export const runtime = 'nodejs';

const resetPasswordSchema = z.object({
  email: z.string().email('Enter a valid email'),
});

export async function POST(request: NextRequest) {
  // Apply rate limiting for password reset (3 attempts per hour per IP)
  const rateLimitResult = await withRateLimit(request, RATE_LIMITS.AUTH_PASSWORD_RESET);
  
  if (!rateLimitResult.success) {
    return rateLimitResult.response;
  }

  try {
    const body = await request.json();
    const { email } = resetPasswordSchema.parse(body);

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Send password reset email
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${request.nextUrl.origin}/update-password`,
    });

    if (error) {
      console.error('Password reset error:', error);
      // Don't reveal if email exists - return success anyway for security
    }

    // Always return success message (don't reveal if email exists)
    return NextResponse.json({
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link shortly.',
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

    console.error('Password reset error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

