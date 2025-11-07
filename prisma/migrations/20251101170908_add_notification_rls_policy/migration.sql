-- Enable Row Level Security on Notification table
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own notifications
-- This policy is required for Supabase Realtime to work properly
-- Cast auth.uid() to TEXT to match the userId column type
-- Only create if auth schema exists (Supabase environment)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') THEN
    CREATE POLICY "realtime_notifications_read" ON "Notification"
      FOR SELECT
      USING (auth.uid()::text = "userId");
  END IF;
END $$;

-- Enable realtime for the Notification table
-- Note: This may need to be enabled manually in the Supabase dashboard if it doesn't work via SQL
-- Go to: Database > Replication > Enable for "Notification" table
-- Only run if supabase_realtime publication exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE "Notification";
  END IF;
END $$;

