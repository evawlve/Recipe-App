---
title: S1.4 – Schema migration: PortionOverride + UserPortionOverride
labels: s1, backend, migration, database
milestone: S1 – Parser + Schema
---

## Summary

Add PortionOverride and UserPortionOverride tables to support custom portion mappings for foods.

## Scope

- Create `PortionOverride` table for global portion overrides
- Create `UserPortionOverride` table for user-specific portion overrides
- Add appropriate indexes and unique constraints
- Create Prisma migration

## Schema Design

### PortionOverride
- `id` (UUID, primary key)
- `foodId` (UUID, foreign key to Food)
- `unit` (string, e.g., "cup", "tbsp")
- `grams` (float, grams per unit)
- `label` (string, optional, e.g., "packed", "heaping")
- `createdAt`, `updatedAt` (timestamps)
- `@@unique([foodId, unit])` - One override per food+unit combination
- `@@index([unit])` - For unit-based queries

### UserPortionOverride
- `id` (UUID, primary key)
- `userId` (UUID, foreign key to User)
- `foodId` (UUID, foreign key to Food)
- `unit` (string)
- `grams` (float)
- `label` (string, optional)
- `createdAt`, `updatedAt` (timestamps)
- `@@unique([userId, foodId, unit])` - One override per user+food+unit
- `@@index([userId, foodId])` - For user food queries

## Acceptance Criteria

- [ ] Migration file created: `prisma/migrations/YYYYMMDDHHMMSS_add_portion_overrides/migration.sql`
- [ ] `PortionOverride` table has correct schema with unique constraint on `[foodId, unit]`
- [ ] `UserPortionOverride` table has correct schema with unique constraint on `[userId, foodId, unit]`
- [ ] Indexes created: `PortionOverride.unit`, `UserPortionOverride.[userId, foodId]`
- [ ] Migration applies cleanly on empty database
- [ ] Migration applies cleanly on seeded database (no conflicts)
- [ ] Migration can be rolled back (down migration works)
- [ ] Tables are queryable in Prisma Studio
- [ ] Prisma Client regenerated successfully

## Technical Notes

- Use `npx prisma migrate dev --name add_portion_overrides` to create migration
- Ensure foreign key constraints are correct
- Consider adding cascade delete behavior if needed
- Update Prisma schema file: `prisma/schema.prisma`

## Related Files

- `prisma/schema.prisma`
- `prisma/migrations/.../migration.sql`

## Testing

- Test migration on clean database
- Test migration on seeded database
- Test rollback migration
- Verify unique constraints work (try inserting duplicate)
- Verify indexes are created (check in database)

