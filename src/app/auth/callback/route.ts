import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' || 
      process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
      process.env.BUILD_TIME === 'true') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Import only when not in build mode
  const { createServerClient } = await import('@supabase/ssr');
  const { cookies } = await import('next/headers');
  const { prisma } = await import('@/lib/db');

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const redirectTo = searchParams.get('redirectTo');
  const isNewUser = searchParams.get('newUser') === 'true';
  // Check if google=true is in the callback URL (most reliable indicator)
  const isGoogleFromUrl = searchParams.get('google') === 'true';
  
  console.log('Auth callback called with URL:', request.url);
  console.log('Auth callback - redirectTo:', redirectTo);
  console.log('Auth callback - isNewUser:', isNewUser);
  console.log('Auth callback - isGoogleFromUrl:', isGoogleFromUrl);
  console.log('Auth callback - all search params:', Object.fromEntries(searchParams.entries()));

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
      // Detect if user signed up with Google OAuth
      // Check multiple sources: app_metadata.provider, identities, and user_metadata
      const providerFromMetadata = data.user.app_metadata?.provider;
      const hasGoogleIdentity = data.user.identities?.some((identity: any) => identity.provider === 'google');
      // Also check if user has Google-related metadata (first_name, last_name from Google)
      const hasGoogleMetadata = !!(data.user.user_metadata?.first_name || data.user.user_metadata?.last_name);
      // Check if the OAuth callback URL contains provider info (Supabase sometimes includes this)
      const urlHasGoogleHint = request.url.includes('provider=google') || request.url.includes('type=google');
      
      // Determine if this is a Google OAuth signup
      // Priority order (most reliable first):
      // 1. google=true in callback URL (explicit parameter we set)
      // 2. hasGoogleIdentity (Supabase identities array - VERY reliable)
      // 3. providerFromMetadata === 'google' (app metadata)
      // 4. hasGoogleMetadata && isNewUser (Google metadata for new users)
      // 5. urlHasGoogleHint (URL contains Google provider hint)
      const isGoogleOAuth = isGoogleFromUrl || // Explicit parameter (most reliable if present)
                            hasGoogleIdentity || // Supabase identities (VERY reliable - check this first if URL param missing)
                            providerFromMetadata === 'google' || 
                            (isNewUser && hasGoogleMetadata) ||
                            urlHasGoogleHint;
      
      try {
        console.log('=== USER METADATA DEBUG ===');
        console.log('User metadata:', JSON.stringify(data.user.user_metadata, null, 2));
        console.log('App metadata:', JSON.stringify(data.user.app_metadata, null, 2));
        console.log('Username from metadata:', data.user.user_metadata?.username);
        console.log('Provider from app_metadata:', providerFromMetadata);
        console.log('Identities:', JSON.stringify(data.user.identities, null, 2));
        console.log('Has Google identity:', hasGoogleIdentity);
        console.log('Has Google metadata:', hasGoogleMetadata);
        console.log('Is new user:', isNewUser);
        console.log('Is Google from URL (google=true param):', isGoogleFromUrl);
        console.log('URL has Google hint:', urlHasGoogleHint);
        console.log('Provider from metadata:', providerFromMetadata);
        console.log('Is Google OAuth (final):', isGoogleOAuth);
        console.log('=== DETECTION BREAKDOWN ===');
        console.log('  - isGoogleFromUrl:', isGoogleFromUrl);
        console.log('  - hasGoogleIdentity:', hasGoogleIdentity);
        console.log('  - providerFromMetadata === "google":', providerFromMetadata === 'google');
        console.log('  - (isNewUser && hasGoogleMetadata):', (isNewUser && hasGoogleMetadata));
        console.log('  - urlHasGoogleHint:', urlHasGoogleHint);
        console.log('===========================');
        
        // Ensure user record exists in our database with proper error handling
        let user;
        try {
          // First, try to find by ID
          user = await prisma.user.findUnique({
            where: { id: data.user.id }
          });

          if (user) {
            // Update existing user with latest metadata, but preserve existing username and custom name
            const updateData: any = {
              email: data.user.email || '',
            };

            // Only update name if it's empty or null (first time setup)
            if (!user.name) {
              updateData.name = data.user.user_metadata?.name || 
                    (data.user.user_metadata?.first_name 
                      ? (data.user.user_metadata?.last_name 
                          ? `${data.user.user_metadata.first_name} ${data.user.user_metadata.last_name}`
                          : data.user.user_metadata.first_name)
                      : data.user.email || 'User');
            }

            // Only update firstName/lastName if they're empty and we have them from OAuth
            if (!user.firstName && data.user.user_metadata?.first_name) {
              updateData.firstName = data.user.user_metadata.first_name;
            }
            if (!user.lastName && data.user.user_metadata?.last_name) {
              updateData.lastName = data.user.user_metadata.last_name;
            }

            // Only update bio if it's empty and we have it from OAuth
            if (!user.bio && data.user.user_metadata?.bio) {
              updateData.bio = data.user.user_metadata.bio;
            }

            // NEVER update username from OAuth metadata - preserve existing username
            console.log('Preserving existing username:', user.username);

            user = await prisma.user.update({
              where: { id: data.user.id },
              data: updateData,
            });
            console.log('Updated existing user in callback:', user.email, 'username:', user.username);
          } else {
            // Check if user exists with same email but different ID
            const existingUser = await prisma.user.findUnique({
              where: { email: data.user.email || '' }
            });

            if (existingUser) {
              // Update the existing user's ID to match Supabase, preserve existing username and custom name
              const updateData: any = {
                id: data.user.id,
              };

              // Only update name if it's empty or null (first time setup)
              if (!existingUser.name) {
                updateData.name = data.user.user_metadata?.name || 
                      (data.user.user_metadata?.first_name 
                        ? (data.user.user_metadata?.last_name 
                            ? `${data.user.user_metadata.first_name} ${data.user.user_metadata.last_name}`
                            : data.user.user_metadata.first_name)
                        : data.user.email || 'User');
              }

              // Only update firstName/lastName if they're empty and we have them from OAuth
              if (!existingUser.firstName && data.user.user_metadata?.first_name) {
                updateData.firstName = data.user.user_metadata.first_name;
              }
              if (!existingUser.lastName && data.user.user_metadata?.last_name) {
                updateData.lastName = data.user.user_metadata.last_name;
              }

              // Only update bio if it's empty and we have it from OAuth
              if (!existingUser.bio && data.user.user_metadata?.bio) {
                updateData.bio = data.user.user_metadata.bio;
              }

              // NEVER update username from OAuth metadata - preserve existing username
              console.log('Preserving existing username for email fallback:', existingUser.username);

              user = await prisma.user.update({
                where: { email: data.user.email || '' },
                data: updateData,
              });
              console.log('Updated user ID for existing email in callback:', user.email, 'username:', user.username);
            } else {
              // Create new user (username will be null initially, user will set it during signup)
              user = await prisma.user.create({
                data: {
                  id: data.user.id,
                  email: data.user.email || '',
                  name: data.user.user_metadata?.name || 
                        (data.user.user_metadata?.first_name 
                          ? (data.user.user_metadata?.last_name 
                              ? `${data.user.user_metadata.first_name} ${data.user.user_metadata.last_name}`
                              : data.user.user_metadata.first_name)
                          : data.user.email || 'User'),
                  firstName: data.user.user_metadata?.first_name || null,
                  lastName: data.user.user_metadata?.last_name || null,
                  // Don't set username from OAuth - user will set it during signup
                  bio: data.user.user_metadata?.bio || null,
                },
              });
              console.log('Created new user in callback:', user.email, 'username:', user.username);
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
          console.log('isGoogleOAuth (before override):', isGoogleOAuth);
          console.log('hasGoogleIdentity (from identities):', hasGoogleIdentity);
          console.log('isNewUser:', isNewUser);
          
          // CRITICAL: If hasGoogleIdentity is true, ALWAYS treat as Google OAuth
          // This is the most reliable indicator since Supabase always sets this for Google OAuth
          // Also check for Google metadata (first_name/last_name) as fallback
          const hasGoogleMetadataInCallback = !!(data.user.user_metadata?.first_name || data.user.user_metadata?.last_name);
          const finalIsGoogleOAuth = isGoogleOAuth || hasGoogleIdentity || hasGoogleMetadataInCallback;
          
          console.log('=== CALLBACK ROUTE FINAL CHECK ===');
          console.log('isGoogleOAuth (before override):', isGoogleOAuth);
          console.log('hasGoogleIdentity:', hasGoogleIdentity);
          console.log('hasGoogleMetadataInCallback:', hasGoogleMetadataInCallback);
          console.log('finalIsGoogleOAuth (after override):', finalIsGoogleOAuth);
          console.log('isNewUser:', isNewUser);
          console.log('==================================');
          
          // Always include google=true for Google OAuth users, and newUser=true if this is a new user
          const googleParam = finalIsGoogleOAuth ? '&google=true' : '';
          const newUserParam = isNewUser ? '&newUser=true' : '';
          const redirectUrl = `${origin}/signup?verified=true&email=${encodeURIComponent(data.user.email || '')}${googleParam}${newUserParam}`;
          console.log('Final Redirect URL:', redirectUrl);
          return NextResponse.redirect(redirectUrl);
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
        // Use hasGoogleIdentity or Google metadata as fallback if isGoogleOAuth is false
        const hasGoogleMetadataInCallback = !!(data.user.user_metadata?.first_name || data.user.user_metadata?.last_name);
        const finalIsGoogleOAuth = isGoogleOAuth || hasGoogleIdentity || hasGoogleMetadataInCallback;
        const googleParam = finalIsGoogleOAuth ? '&google=true' : '';
        const newUserParam = isNewUser ? '&newUser=true' : '';
        console.log('Database error - finalIsGoogleOAuth:', finalIsGoogleOAuth);
        console.log('Database error - Redirect URL:', `${origin}/signup?verified=true&email=${encodeURIComponent(data.user.email || '')}${googleParam}${newUserParam}`);
        return NextResponse.redirect(`${origin}/signup?verified=true&email=${encodeURIComponent(data.user.email || '')}${googleParam}${newUserParam}`);
      }
    } else {
      console.error('OAuth callback error:', error);
      return NextResponse.redirect(`${origin}/signin?error=auth_callback_error&message=${encodeURIComponent(error?.message || 'Authentication failed')}`);
    }
  }

  // If there's an error or no code, redirect to signin
  return NextResponse.redirect(`${origin}/signin?error=auth_callback_error&message=${encodeURIComponent('No verification code provided')}`);
}
