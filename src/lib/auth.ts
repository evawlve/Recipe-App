import { prisma } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isTokenError } from "@/lib/auth-utils";

export async function getCurrentUser() {
  try {
    const supabase = await createSupabaseServerClient();
    
    // Get the user from the server (more secure than getSession)
    const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
      // Handle specific auth errors
      if (isTokenError(userError)) {
        console.log('Invalid refresh token, clearing session');
        await supabase.auth.signOut();
        return null;
      }
      console.log('Auth error:', userError?.message);
      return null;
    }
    
    if (!authUser) {
      console.log('No valid session found');
      return null;
    }
    console.log('Found authenticated user:', authUser.email);

    // Find or create user in our database with proper error handling
    let user;
    try {
      // First, try to find by ID with all fields
      user = await prisma.user.findUnique({
        where: { id: authUser.id },
        select: {
          id: true,
          email: true,
          name: true,
          firstName: true,
          lastName: true,
          username: true,
          displayName: true,
          bio: true,
          avatarUrl: true,
          avatarKey: true,
          createdAt: true,
        }
      });
      
      console.log('Initial user fetch - username:', user?.username);

      if (user) {
        console.log('Found existing user with username:', user.username);
        
        // Update existing user with latest metadata, but preserve all custom profile data
        const updateData: any = {
          email: authUser.email || '',
        };

        // Only update name if it's empty or null (first time setup)
        if (!user.name) {
          updateData.name = authUser.user_metadata?.name || 
                `${authUser.user_metadata?.first_name || ''} ${authUser.user_metadata?.last_name || ''}`.trim() ||
                authUser.email || 'User';
        }

        // Only update firstName/lastName if they're empty and we have them from OAuth
        if (!user.firstName && authUser.user_metadata?.first_name) {
          updateData.firstName = authUser.user_metadata.first_name;
        }
        if (!user.lastName && authUser.user_metadata?.last_name) {
          updateData.lastName = authUser.user_metadata.last_name;
        }

        console.log('Update data being sent to database:', updateData);

        user = await prisma.user.update({
          where: { id: authUser.id },
          data: updateData,
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarKey: true,
            createdAt: true,
          }
        });
        console.log('Updated existing user:', user.email, 'username:', user.username);
      } else {
        // Check if user exists with same email but different ID
        const existingUser = await prisma.user.findUnique({
          where: { email: authUser.email || '' }
        });

        if (existingUser) {
          // Update the existing user's ID to match Supabase, preserve all profile data
          const updateData: any = {
            id: authUser.id,
          };

          // Only update name if it's empty or null (preserve existing profile data)
          if (!existingUser.name) {
            updateData.name = authUser.user_metadata?.name || 
                  `${authUser.user_metadata?.first_name || ''} ${authUser.user_metadata?.last_name || ''}`.trim() ||
                  authUser.email || 'User';
          }

          // Only update firstName/lastName if they're empty and we have them from OAuth
          if (!existingUser.firstName && authUser.user_metadata?.first_name) {
            updateData.firstName = authUser.user_metadata.first_name;
          }
          if (!existingUser.lastName && authUser.user_metadata?.last_name) {
            updateData.lastName = authUser.user_metadata.last_name;
          }

          user = await prisma.user.update({
            where: { email: authUser.email || '' },
            data: updateData,
            select: {
              id: true,
              email: true,
              name: true,
              firstName: true,
              lastName: true,
              username: true,
              displayName: true,
              bio: true,
              avatarUrl: true,
              avatarKey: true,
              createdAt: true,
            }
          });
          console.log('Updated user ID for existing email:', user.email, 'username:', user.username);
        } else {
          // Create new user
          user = await prisma.user.create({
            data: {
              id: authUser.id,
              email: authUser.email || '',
              name: authUser.user_metadata?.name || 
                    `${authUser.user_metadata?.first_name || ''} ${authUser.user_metadata?.last_name || ''}`.trim() ||
                    authUser.email || 'User',
            },
            select: {
              id: true,
              email: true,
              name: true,
              firstName: true,
              lastName: true,
              username: true,
              displayName: true,
              bio: true,
              avatarUrl: true,
              avatarKey: true,
              createdAt: true,
            }
          });
          console.log('Created new user:', user.email, 'username:', user.username);
        }
      }
    } catch (error) {
      console.error('Error in user upsert, attempting fallback:', error);
      // Fallback: try to find by email and update
      try {
        user = await prisma.user.findUnique({
          where: { email: authUser.email || '' },
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            username: true,
            displayName: true,
            bio: true,
            avatarUrl: true,
            avatarKey: true,
            createdAt: true,
          }
        });
        if (user) {
          console.log('Found user by email fallback:', user.email, 'username:', user.username);
        }
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
        throw error; // Re-throw original error
      }
    }
    
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}

export async function optionalUser() {
  try {
    return await getCurrentUser();
  } catch (error) {
    return null;
  }
}
