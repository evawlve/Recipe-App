# Manual Migration Instructions

## How to Apply This Migration via Supabase

### Step 1: Copy the SQL
Open [`migration.sql`](./migration.sql) and copy its entire contents.

### Step 2: Apply in Supabase SQL Editor
1. Go to your Supabase Dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Paste the migration SQL
5. Click **Run**

### Step 3: Record the Migration
After the migration completes successfully, run this INSERT statement in the SQL editor:

```sql
INSERT INTO "_prisma_migrations" (
  "id",
  "checksum",
  "finished_at",
  "migration_name",
  "logs",
  "rolled_back_at",
  "started_at",
  "applied_steps_count"
) VALUES (
  'manual_20241124_cleanup_patterns',
  'checksum_manual_20241124_cleanup_system',
  NOW(),
  '20241124184000_add_ingredient_cleanup_patterns',
  '',
  NULL,
  NOW(),
  1
);
```

### Step 4: Verify
Check that the tables were created:

```sql
-- Check tables exist
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE '%Cleanup%';

-- Check initial patterns were seeded
SELECT COUNT(*) as pattern_count 
FROM "IngredientCleanupPattern";
-- Should return 9
```

### Step 5: Generate Prisma Client
After applying the migration, regenerate your Prisma client locally:

```bash
npx prisma generate
```

This will update your TypeScript types to include the new models.

---

## What This Migration Does

✅ Creates 2 new enums: `PatternType` and `PatternSource`  
✅ Creates `IngredientCleanupPattern` table for storing cleanup rules  
✅ Creates `IngredientCleanupApplication` table for tracking usage  
✅ Adds all necessary indexes for performance  
✅ Seeds 9 initial patterns that fix current failures  

## Rollback (if needed)

If you need to rollback this migration:

```sql
-- Drop tables (CASCADE will remove applications too)
DROP TABLE IF EXISTS "IngredientCleanupApplication" CASCADE;
DROP TABLE IF EXISTS "IngredientCleanupPattern" CASCADE;

-- Drop enums
DROP TYPE IF EXISTS "PatternSource";
DROP TYPE IF EXISTS "PatternType";

-- Remove from migrations table
DELETE FROM "_prisma_migrations" 
WHERE "id" = 'manual_20241124_cleanup_patterns';
```
