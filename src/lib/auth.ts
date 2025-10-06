import { prisma } from "@/lib/db";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getCurrentUser() {
  try {
    const supabase = await createSupabaseServerClient();
    
    // Get the user from the server (more secure than getSession)
    const { data: { user: authUser }, error: userError } = await supabase.auth.getUser();
    
    if (userError || !authUser) {
      console.log('No valid session found:', userError?.message);
      return null;
    }
    console.log('Found authenticated user:', authUser.email);

    // Find or create user in our database with proper error handling
    let user;
    try {
      // First, try to find by ID
      user = await prisma.user.findUnique({
        where: { id: authUser.id }
      });

      if (user) {
        // Update existing user with latest metadata
        user = await prisma.user.update({
          where: { id: authUser.id },
          data: {
            email: authUser.email || '',
            name: authUser.user_metadata?.name || 
                  `${authUser.user_metadata?.first_name || ''} ${authUser.user_metadata?.last_name || ''}`.trim() ||
                  authUser.email || 'User',
          },
        });
        console.log('Updated existing user:', user.email);
      } else {
        // Check if user exists with same email but different ID
        const existingUser = await prisma.user.findUnique({
          where: { email: authUser.email || '' }
        });

        if (existingUser) {
          // Update the existing user's ID to match Supabase
          user = await prisma.user.update({
            where: { email: authUser.email || '' },
            data: {
              id: authUser.id,
              name: authUser.user_metadata?.name || 
                    `${authUser.user_metadata?.first_name || ''} ${authUser.user_metadata?.last_name || ''}`.trim() ||
                    authUser.email || 'User',
            },
          });
          console.log('Updated user ID for existing email:', user.email);
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
          });
          console.log('Created new user:', user.email);
        }
      }
    } catch (error) {
      console.error('Error in user upsert, attempting fallback:', error);
      // Fallback: try to find by email and update
      try {
        user = await prisma.user.findUnique({
          where: { email: authUser.email || '' }
        });
        if (user) {
          console.log('Found user by email fallback:', user.email);
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
