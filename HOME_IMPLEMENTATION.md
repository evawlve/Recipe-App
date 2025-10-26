# Home Page Implementation

This document describes the implementation of the Home MVP following the Figma design.

## Files Created/Modified

### New Files Created:
- `src/lib/feeds/trending.ts` - Trending recipes algorithm with scoring
- `src/components/home/HomeSection.tsx` - Section wrapper component
- `src/components/home/TrendingRail.tsx` - Horizontal scroll component
- `src/components/home/CategoryTile.tsx` - Category browse tiles
- `public/images/cat/*.svg` - Placeholder category images

### Modified Files:
- `src/app/page.tsx` - Main home page layout
- `src/app/globals.css` - Added no-scrollbar utility

## Features Implemented

### 1. Search Bar
- Full-width search bar with search icon
- Placeholder text: "Search recipes"
- Styled with rounded corners and muted background

### 2. Trending Recipes
- Horizontal scrollable rail with up to 12 recipes
- Scoring algorithm: `(likes + 2*comments) * exp(-hours_since_posted / 96)`
- Fallback to newest recipes from last 30 days if no trending data
- Uses existing RecipeCard component
- Desktop: chevron navigation buttons
- Mobile: touch scroll

### 3. Browse by Category
- Grid layout with 6 meal type categories
- Categories: Breakfast, Lunch, Dinner, Snacks, Desserts, Drinks
- Links to `/recipes?tags=<slug>` for filtering
- Responsive grid: 1-5 columns based on screen size
- Placeholder SVG images with category names

## Technical Details

### Trending Algorithm
```typescript
const score = (likes + 2*comments) * Math.exp(-hours_since_posted / 96)
```
- 4-day half-life for recency decay
- Comments weighted 2x more than likes
- Fallback to newest if no engagement data

### Responsive Design
- Mobile: 1-2 columns for categories
- Tablet: 3 columns for categories  
- Desktop: 5 columns for categories
- Trending rail: horizontal scroll with snap behavior

### Accessibility
- Proper ARIA labels for navigation buttons
- Alt text for category images
- Keyboard navigation support
- Screen reader friendly

## Usage

The home page is now available at `/` and includes:
1. Search functionality (placeholder for now)
2. Trending recipes with engagement-based scoring
3. Category browsing with deep linking to filtered recipe pages

All components are reusable and follow the existing design system patterns.
