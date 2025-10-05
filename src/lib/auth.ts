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

    // Find or create user in our database
    let user = await prisma.user.findUnique({ 
      where: { id: authUser.id } 
    });
    
    if (!user) {
      console.log('Creating new user record for:', authUser.email);
      // Create user record if it doesn't exist
      user = await prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email || '',
          name: authUser.user_metadata?.name || authUser.email || 'User',
        },
      });
    } else {
      console.log('Found existing user:', user.email);
    }
    
    return user;
  } catch (error) {
    console.error('Error getting current user:', error);
    return null;
  }
}
