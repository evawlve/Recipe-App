-- Enable pg_trgm extension for trigram similarity search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Recipe title trigram index for fuzzy text search
CREATE INDEX IF NOT EXISTS recipe_title_trgm_idx 
ON "Recipe" USING GIN (LOWER(title) gin_trgm_ops);

-- User username trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS user_username_trgm_idx 
ON "User" USING GIN (LOWER(username) gin_trgm_ops);

-- User displayName trigram index for fuzzy search
CREATE INDEX IF NOT EXISTS user_display_trgm_idx 
ON "User" USING GIN (LOWER("displayName") gin_trgm_ops);

-- Recipe tags array index for tag-based search
-- Note: GIN index on RecipeTag.tagId already exists via @@index([tagId])
-- Adding composite index for efficient tag filtering with recipe joins
CREATE INDEX IF NOT EXISTS recipe_tag_composite_idx 
ON "RecipeTag" ("tagId", "recipeId");

