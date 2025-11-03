import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { withRateLimit } from '@/lib/auth/with-rate-limit';
import { RATE_LIMITS, getClientIp } from '@/lib/auth/rate-limit';
import { validatePassword } from '@/lib/auth/password-validation';

export const runtime = 'nodejs';

const signupSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .refine((password) => {
      const strength = validatePassword(password);
      return strength.isValid;
    }, {
      message: 'Password does not meet security requirements',
    }),
});

export async function POST(request: NextRequest) {
  // Apply rate limiting for signup (3 attempts per hour per IP)
  const rateLimitResult = await withRateLimit(request, RATE_LIMITS.AUTH_SIGNUP);
  
  if (!rateLimitResult.success) {
    return rateLimitResult.response;
  }

  try {
    const body = await request.json();
    const { email, password } = signupSchema.parse(body);

    // Additional email validation - prevent disposable/temporary emails
    const disposableDomains = [
      'tempmail.com', 'throwaway.email', '10minutemail.com', 
      'guerrillamail.com', 'mailinator.com', 'trashmail.com'
    ];
    
    const emailDomain = email.split('@')[1]?.toLowerCase();
    if (disposableDomains.includes(emailDomain)) {
      return NextResponse.json(
        {
          error: 'Invalid email',
          message: 'Please use a permanent email address',
        },
        { status: 400 }
      );
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Attempt to sign up
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Email confirmation is required - user must verify email
        emailRedirectTo: `${request.nextUrl.origin}/auth/callback`,
      },
    });

    if (error) {
      return NextResponse.json(
        {
          error: 'Signup failed',
          message: error.message,
        },
        { status: 400 }
      );
    }

    // Check if email confirmation is required
    const requiresConfirmation = data.user && !data.session;

    return NextResponse.json({
      success: true,
      requiresConfirmation,
      message: requiresConfirmation 
        ? 'Please check your email to verify your account before signing in.'
        : 'Account created successfully',
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

    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

