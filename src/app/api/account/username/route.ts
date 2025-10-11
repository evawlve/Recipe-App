import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const usernameSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(20, 'Username must be at most 20 characters')
    .regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores'),
});

export async function PATCH(request: NextRequest) {
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
