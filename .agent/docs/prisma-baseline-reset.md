# Prisma Baseline Reset Guide

How to fix migration drift permanently without losing data.

## Current Situation

Migrations have been applied manually via Supabase SQL editor and recorded in `_prisma_migrations`, causing drift between local migration files and actual database state.

## Prerequisites

- Supabase database credentials
- Local development environment
- Backup of production data (recommended)

## Step-by-Step Baseline Reset

### 1. Backup Important Data (Optional but Recommended)

```sql
-- Export critical tables via Supabase dashboard or pg_dump
```

### 2. Delete Local Migrations

```bash
# Remove old migration files (keep schema.prisma)
rm -rf prisma/migrations
```

### 3. Create Baseline Migration Folder

```bash
mkdir -p prisma/migrations/0_baseline
```

### 4. Generate Baseline SQL from Current Schema

```bash
# Generate SQL that would create current schema from scratch
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_baseline/migration.sql
```

### 5. Clear Old Migration Records (Supabase SQL Editor)

```sql
-- Remove all existing migration records
DELETE FROM "_prisma_migrations";

-- Insert single baseline migration record
INSERT INTO "_prisma_migrations" (
  "id", "checksum", "finished_at", "migration_name", 
  "logs", "rolled_back_at", "started_at", "applied_steps_count"
) VALUES (
  'baseline_init',
  'baseline_checksum',
  NOW(),
  '0_baseline',
  '',
  NULL,
  NOW(),
  1
);
```

### 6. Verify Sync

```bash
npx prisma migrate status
```

Should show: `Database schema is up to date!`

### 7. Future Migrations Work Normally

```bash
npx prisma migrate dev --name your_next_feature
```

## Alternative: Shadow Database Setup

For safer development, add a shadow database:

```env
# .env
DATABASE_URL="postgresql://...production..."
SHADOW_DATABASE_URL="postgresql://...development..."
```

This lets Prisma test migrations against the shadow DB before applying to production.

## Rollback Plan

If something goes wrong:
1. Restore from backup
2. Re-run the baseline steps
3. Re-apply the old `_prisma_migrations` entries

---

**Estimated Time:** 15-30 minutes  
**Risk Level:** Low (no data changes, only migration metadata)
