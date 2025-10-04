-- Fix: Ensure User table has records for authenticated users
-- This script will create User records for any authenticated users that don't exist

-- First, let's see what users exist in auth.users but not in public.User
-- (This is a diagnostic query - run this first to see what's missing)

-- Create a function to automatically create User records when someone signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public."User" (id, email, name, "createdAt")
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create User record when auth.users gets a new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- For existing users, manually create User records if they don't exist
INSERT INTO public."User" (id, email, name, "createdAt")
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'name', au.email),
  au.created_at
FROM auth.users au
LEFT JOIN public."User" u ON au.id = u.id
WHERE u.id IS NULL;

-- Update RLS policies to be more permissive for testing
-- Allow users to create recipes even if they don't have a User record yet
DROP POLICY IF EXISTS "Users can create recipes" ON "Recipe";
CREATE POLICY "Users can create recipes" ON "Recipe"
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND 
    (auth.uid()::text = "authorId" OR 
     EXISTS (SELECT 1 FROM public."User" WHERE id = auth.uid()::text))
  );

-- Also update the User table policy to allow self-creation
DROP POLICY IF EXISTS "Users can create own profile" ON "User";
CREATE POLICY "Users can create own profile" ON "User"
  FOR INSERT WITH CHECK (auth.uid()::text = id);
