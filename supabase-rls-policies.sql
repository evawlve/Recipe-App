-- Enable Row Level Security on all tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ingredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Nutrition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecipeTag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Comment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Like" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Collection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CollectionRecipe" ENABLE ROW LEVEL SECURITY;

-- User table policies
-- Users can only see and modify their own data
CREATE POLICY "Users can view own profile" ON "User"
  FOR SELECT USING (auth.uid()::text = id);

CREATE POLICY "Users can update own profile" ON "User"
  FOR UPDATE USING (auth.uid()::text = id);

-- Recipe table policies
-- Users can see all recipes, but only modify their own
CREATE POLICY "Anyone can view recipes" ON "Recipe"
  FOR SELECT USING (true);

CREATE POLICY "Users can create recipes" ON "Recipe"
  FOR INSERT WITH CHECK (auth.uid()::text = "authorId");

CREATE POLICY "Users can update own recipes" ON "Recipe"
  FOR UPDATE USING (auth.uid()::text = "authorId");

CREATE POLICY "Users can delete own recipes" ON "Recipe"
  FOR DELETE USING (auth.uid()::text = "authorId");

-- Ingredient table policies
-- Users can see ingredients for all recipes, but only modify their own
CREATE POLICY "Anyone can view ingredients" ON "Ingredient"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage ingredients for own recipes" ON "Ingredient"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Ingredient"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Nutrition table policies
-- Users can see nutrition for all recipes, but only modify their own
CREATE POLICY "Anyone can view nutrition" ON "Nutrition"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage nutrition for own recipes" ON "Nutrition"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Nutrition"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Photo table policies
-- Users can see photos for all recipes, but only modify their own
CREATE POLICY "Anyone can view photos" ON "Photo"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage photos for own recipes" ON "Photo"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "Photo"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Tag table policies
-- Anyone can view tags, but only authenticated users can create them
CREATE POLICY "Anyone can view tags" ON "Tag"
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can create tags" ON "Tag"
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- RecipeTag table policies
-- Users can see all recipe-tag relationships, but only modify their own
CREATE POLICY "Anyone can view recipe tags" ON "RecipeTag"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage tags for own recipes" ON "RecipeTag"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Recipe" 
      WHERE "Recipe".id = "RecipeTag"."recipeId" 
      AND "Recipe"."authorId" = auth.uid()::text
    )
  );

-- Comment table policies
-- Users can see all comments, but only modify their own
CREATE POLICY "Anyone can view comments" ON "Comment"
  FOR SELECT USING (true);

CREATE POLICY "Users can create comments" ON "Comment"
  FOR INSERT WITH CHECK (auth.uid()::text = "userId");

CREATE POLICY "Users can update own comments" ON "Comment"
  FOR UPDATE USING (auth.uid()::text = "userId");

CREATE POLICY "Users can delete own comments" ON "Comment"
  FOR DELETE USING (auth.uid()::text = "userId");

-- Like table policies
-- Users can see all likes, but only manage their own
CREATE POLICY "Anyone can view likes" ON "Like"
  FOR SELECT USING (true);

CREATE POLICY "Users can manage own likes" ON "Like"
  FOR ALL USING (auth.uid()::text = "userId");

-- Collection table policies
-- Users can only see and modify their own collections
CREATE POLICY "Users can view own collections" ON "Collection"
  FOR SELECT USING (auth.uid()::text = "userId");

CREATE POLICY "Users can create collections" ON "Collection"
  FOR INSERT WITH CHECK (auth.uid()::text = "userId");

CREATE POLICY "Users can update own collections" ON "Collection"
  FOR UPDATE USING (auth.uid()::text = "userId");

CREATE POLICY "Users can delete own collections" ON "Collection"
  FOR DELETE USING (auth.uid()::text = "userId");

-- CollectionRecipe table policies
-- Users can only manage collections they own
CREATE POLICY "Users can view own collection recipes" ON "CollectionRecipe"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "Collection" 
      WHERE "Collection".id = "CollectionRecipe"."collectionId" 
      AND "Collection"."userId" = auth.uid()::text
    )
  );

CREATE POLICY "Users can manage own collection recipes" ON "CollectionRecipe"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Collection" 
      WHERE "Collection".id = "CollectionRecipe"."collectionId" 
      AND "Collection"."userId" = auth.uid()::text
    )
  );
