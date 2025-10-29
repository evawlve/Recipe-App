import { NextRequest, NextResponse } from 'next/server';

// Schema will be defined after dynamic import

export async function PATCH(request: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' || 
      process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
      process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Import only when not in build mode
  const { prisma } = await import('@/lib/db');
  const { createSupabaseServerClient } = await import('@/lib/supabase/server');
  const { z } = await import('zod');

  const usernameSchema = z.object({
    username: z.string()
      .min(3, 'Username must be at least 3 characters')
      .max(20, 'Username must be at most 20 characters')
      .regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores'),
  });

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { username } = usernameSchema.parse(body);

    // Check if username is already taken (case-insensitive)
    const existingUser = await prisma.user.findFirst({
      where: {
        username: {
          equals: username,
          mode: 'insensitive'
        }
      }
    });

    if (existingUser && existingUser.id !== user.id) {
      return NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
    }

    // Update user with username only
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        username: username.toLowerCase(),
      },
    });

    return NextResponse.json({ 
      ok: true, 
      username: updatedUser.username 
    });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ 
        error: 'Invalid input', 
        details: error.errors 
      }, { status: 400 });
    }

    console.error('Username update error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
