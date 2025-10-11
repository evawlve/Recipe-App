import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirectTo');
  const isNewUser = searchParams.get('newUser') === 'true';
  
  console.log('Auth callback called with URL:', request.url);
  console.log('Auth callback - redirectTo:', redirectTo);

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return cookieStore.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            cookieStore.set({ name, value, ...options });
          },
          remove(name: string, options: any) {
            cookieStore.set({ name, value: '', ...options });
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error && data.user) {
      try {
        console.log('=== USER METADATA DEBUG ===');
        console.log('User metadata:', data.user.user_metadata);
        console.log('Username from metadata:', data.user.user_metadata?.username);
        console.log('Provider:', data.user.app_metadata?.provider);
        console.log('===========================');
        
        // Detect if user signed up with Google OAuth
        const isGoogleOAuth = data.user.app_metadata?.provider === 'google';
        
        // Ensure user record exists in our database with proper error handling
        let user;
        try {
          // First, try to find by ID
          user = await prisma.user.findUnique({
            where: { id: data.user.id }
          });

          if (user) {
            // Update existing user with latest metadata
            user = await prisma.user.update({
              where: { id: data.user.id },
              data: {
                email: data.user.email || '',
                name: data.user.user_metadata?.name || 
                      `${data.user.user_metadata?.first_name || ''} ${data.user.user_metadata?.last_name || ''}`.trim() ||
                      data.user.email || 'User',
                firstName: data.user.user_metadata?.first_name || null,
                lastName: data.user.user_metadata?.last_name || null,
                username: data.user.user_metadata?.username || null,
                bio: data.user.user_metadata?.bio || null,
              },
            });
            console.log('Updated existing user in callback:', user.email);
          } else {
            // Check if user exists with same email but different ID
            const existingUser = await prisma.user.findUnique({
              where: { email: data.user.email || '' }
            });

            if (existingUser) {
              // Update the existing user's ID to match Supabase
              user = await prisma.user.update({
                where: { email: data.user.email || '' },
                data: {
                  id: data.user.id,
                  name: data.user.user_metadata?.name || 
                        `${data.user.user_metadata?.first_name || ''} ${data.user.user_metadata?.last_name || ''}`.trim() ||
                        data.user.email || 'User',
                  firstName: data.user.user_metadata?.first_name || null,
                  lastName: data.user.user_metadata?.last_name || null,
                  username: data.user.user_metadata?.username || null,
                  bio: data.user.user_metadata?.bio || null,
                },
              });
              console.log('Updated user ID for existing email in callback:', user.email);
            } else {
              // Create new user
              user = await prisma.user.create({
                data: {
                  id: data.user.id,
                  email: data.user.email || '',
                  name: data.user.user_metadata?.name || 
                        `${data.user.user_metadata?.first_name || ''} ${data.user.user_metadata?.last_name || ''}`.trim() ||
                        data.user.email || 'User',
                  firstName: data.user.user_metadata?.first_name || null,
                  lastName: data.user.user_metadata?.last_name || null,
                  username: data.user.user_metadata?.username || null,
                  bio: data.user.user_metadata?.bio || null,
                },
              });
              console.log('Created new user in callback:', user.email);
            }
          }
        } catch (userError) {
          console.error('Error in user creation/update in callback:', userError);
          // Fallback: try to find by email
          try {
            user = await prisma.user.findUnique({
              where: { email: data.user.email || '' }
            });
            if (user) {
              console.log('Found user by email fallback in callback:', user.email);
            }
          } catch (fallbackError) {
            console.error('Fallback also failed in callback:', fallbackError);
            // Continue without user record - auth will still work
            user = null;
          }
        }

        // Check if user has completed profile setup (has username)
        const needsProfileSetup = !user?.username;
        console.log('=== AUTH CALLBACK DEBUG ===');
        console.log('User ID:', user?.id);
        console.log('User email:', user?.email);
        console.log('User username:', user?.username);
        console.log('User firstName:', user?.firstName);
        console.log('User lastName:', user?.lastName);
        console.log('Needs profile setup:', needsProfileSetup);
        console.log('========================');

        // Redirect based on profile completion status
        if (needsProfileSetup) {
          // User needs to complete profile setup
          console.log('Redirecting user to signup profile setup');
          const googleParam = isGoogleOAuth ? '&google=true' : '';
          return NextResponse.redirect(`${origin}/signup?verified=true&email=${encodeURIComponent(data.user.email || '')}${googleParam}`);
        } else {
          // User has completed profile setup, redirect to app
          const finalRedirectTo = redirectTo || '/recipes';
          console.log('Redirecting user to app:', finalRedirectTo);
          return NextResponse.redirect(`${origin}${finalRedirectTo}`);
        }
      } catch (dbError) {
        console.error('Database error during user creation:', dbError);
        // If there's a database error, assume user needs profile setup
        console.log('Database error, redirecting to profile setup');
        const googleParam = isGoogleOAuth ? '&google=true' : '';
        return NextResponse.redirect(`${origin}/signup?verified=true&email=${encodeURIComponent(data.user.email || '')}${googleParam}`);
      }
    } else {
      console.error('OAuth callback error:', error);
      return NextResponse.redirect(`${origin}/signin?error=auth_callback_error&message=${encodeURIComponent(error?.message || 'Authentication failed')}`);
    }
  }

  // If there's an error or no code, redirect to signin
  return NextResponse.redirect(`${origin}/signin?error=auth_callback_error&message=${encodeURIComponent('No verification code provided')}`);
}
