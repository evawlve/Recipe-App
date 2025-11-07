# Main Photo Feature Implementation

## Overview
Implemented the ability to select a "main photo" for recipes. By default, the first uploaded photo is the main photo, but users can select any other uploaded photo to be the main photo that displays on recipe cards throughout the app.

## Changes Made

### 1. Database Schema
- **File**: `prisma/schema.prisma`
- Added `isMainPhoto` boolean field to the `Photo` model (defaults to `false`)
- Added composite index on `[recipeId, isMainPhoto]` for efficient queries

### 2. Migration
- **File**: `prisma/migrations/20251105000000_add_main_photo_flag/migration.sql`
- Adds the `isMainPhoto` column
- Creates the index
- **Automatically sets the first photo of each existing recipe as the main photo**

### 3. API Endpoints
- **File**: `src/app/api/photos/[id]/route.ts`
- Added `PATCH` endpoint to set a photo as the main photo
- Ensures only one photo per recipe can be marked as main (uses transaction)
- Requires user to be the recipe author

### 4. UI Components
- **File**: `src/components/recipe/PhotoGallery.tsx`
  - Added visual indicator (star icon + "Main Photo" badge) for the main photo
  - Added "Set Main" button on non-main photos (appears on hover)
  - Implemented optimistic UI updates
  - Added sliding functionality with navigation arrows and dot indicators
  - Photos scroll horizontally when multiple images are present

### 5. Recipe Queries
Updated all recipe queries to:
- Include `isMainPhoto` field in photo selections
- Order photos by `isMainPhoto DESC, id ASC` (main photo always first)

**Files updated**:
- `src/app/recipes/[id]/page.tsx` - Recipe detail page
- `src/app/recipes/[id]/edit/page.tsx` - Edit recipe page
- `src/lib/recipes/query.ts` - Recipe listing queries
- `src/app/api/feed/foryou/route.ts` - For You feed
- `src/app/api/feed/following/route.ts` - Following feed
- `src/app/api/discover/popular/route.ts` - Popular recipes
- `src/app/api/recipes/[id]/similar/route.ts` - Similar recipes
- `src/app/api/me/uploaded/route.ts` - User's uploaded recipes
- `src/app/api/me/saved/route.ts` - User's saved recipes
- `src/app/api/discover/suggest-creators/route.ts` - Creator suggestions

### 6. Type Definitions
- **File**: `src/components/recipe/RecipeCard.tsx`
- Updated `RecipeWithRelations` interface to include `isMainPhoto` field

## How to Deploy

### 1. Run the Database Migration
```bash
npx prisma migrate deploy
```

Or for development:
```bash
npx prisma migrate dev
```

### 2. Generate Prisma Client
```bash
npx prisma generate
```

### 3. Deploy the Application
The changes are fully backward compatible. Old recipes without a main photo set will automatically have their first photo marked as main during the migration.

## User Experience

### For Recipe Authors
1. Navigate to your recipe detail page
2. Hover over any photo in the gallery
3. Click "Set Main" button to designate it as the main photo
4. The main photo is indicated with a star icon and "Main Photo" badge
5. Only one photo can be the main photo at a time

### Photo Gallery Features
- **Horizontal Scrolling**: When multiple photos are present, they scroll horizontally
- **Navigation Arrows**: Left/right arrows appear when scrolling is possible
- **Dot Indicators**: Small dots at the bottom show current position and allow jumping to any photo
- **Touch/Swipe Support**: Works naturally on mobile devices
- **Hidden Scrollbar**: Clean appearance without visible scrollbar

### Display Behavior
- Recipe cards always display the main photo (or first photo if none is explicitly set)
- Main photo appears first in the photo gallery
- All recipe listings respect the main photo selection

## Technical Notes

- The feature uses optimistic UI updates for instant feedback
- Transaction ensures data consistency (only one main photo per recipe)
- Authorization checks ensure only recipe authors can change the main photo
- Photos are ordered by `isMainPhoto DESC, id ASC` in all queries for consistency
- The migration automatically handles existing recipes

## Testing Checklist

- [ ] Main photo displays correctly on recipe cards
- [ ] Can set different photos as main
- [ ] Main photo badge appears on correct photo
- [ ] "Set Main" button only appears on non-main photos
- [ ] Only recipe author can set main photo
- [ ] Photo gallery scrolls horizontally with multiple photos
- [ ] Navigation arrows work correctly
- [ ] Dot indicators update based on scroll position
- [ ] Changes persist after page reload
- [ ] Works on mobile devices with touch/swipe

