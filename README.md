# Mealspire (Next.js + Prisma + PostgreSQL + S3 + Supabase Auth)

A full-featured recipe management application with:
- **Next.js 15** (App Router, TypeScript)
- **Prisma + PostgreSQL** for data persistence
- **AWS S3** for secure image storage with API proxy
- **Supabase Auth** for secure authentication (Email + Google OAuth)
- **React Hook Form + Zod** for form validation
- **Tailwind CSS + shadcn/ui** for modern UI
- **Image upload with drag & drop** functionality
- **Draft persistence** with localStorage
- **Responsive design** with mobile-first approach
- **Row Level Security (RLS)** for database-level security
- **Recipe editing** with ownership validation
- **Modern UI/UX** with consistent branding

## 🚀 Features

### **Recipe Management**
- ✅ **Full CRUD operations** - Create, edit, delete (single & bulk) with ownership validation
- ✅ **Image upload** with drag & drop, automatic WebP compression, and gallery management
- ✅ **Smart forms** - React Hook Form + Zod validation with draft persistence and auto-focus
- ✅ **Advanced search & filtering** - Search across titles, instructions, tags, and ingredients
- ✅ **Tag system** - Autocomplete, namespaces (meal type, cuisine, diet, method), and auto-suggestions
- ✅ **Author discovery** - Clickable author avatars and names for user discovery

### **Image Handling**
- ✅ **CloudFront CDN** - Direct image serving from CloudFront for optimal LCP/FCP performance
- ✅ **Secure S3 storage** - Private bucket with Origin Access Control (OAC), presigned uploads
- ✅ **Smart compression** - Automatic WebP conversion, EXIF orientation, 15MB limit
- ✅ **Optimization** - Priority loading for above-fold images, responsive sizes, blur placeholders
- ✅ **Performance** - DNS prefetch, preconnect, Next.js Image optimization with CDN caching

### **Authentication & Security**
- ✅ **Supabase Auth** - Email/password and Google OAuth authentication
- ✅ **Password Security** - Strong requirements (8+ chars, uppercase, lowercase, numbers, special chars) with real-time strength indicator using zxcvbn
- ✅ **Password Encryption** - Automatic bcrypt hashing with unique salts (handled by Supabase)
- ✅ **Email Verification** - Required for all new accounts to prevent fake signups
- ✅ **Password Reset Flow** - Secure one-time tokens via email at `/forgot-password` and `/update-password`
- ✅ **Account Deletion** - Complete data removal including recipes, interactions, and Supabase Auth records
- ✅ **Rate Limiting** - IP-based limits on auth endpoints (3-5 attempts per hour) to prevent brute force attacks
- ✅ **Account Lockout** - Progressive delays and 15-minute lockout after 5 failed login attempts
- ✅ **Security Headers** - CSP, X-Frame-Options, HSTS, XSS protection on all responses via middleware
- ✅ **Session Security** - httpOnly cookies with sameSite protection and automatic HTTPS enforcement in production
- ✅ **Row Level Security (RLS)** - Database-level security policies
- ✅ **Owner-only access** - Users can only modify their own content
- ✅ **Public read access** - Anyone can view recipes (social features)
- ✅ **Secure S3 operations** - Automatic cleanup of deleted images
- ✅ **Transaction safety** - Atomic operations for data consistency
- ✅ **Session management** - Secure server-side session validation
- ✅ **OAuth callback handling** - Proper Google OAuth flow
- ✅ **Page guards** - Protected routes redirect to signin
- ✅ **Auth state display** - Header shows user info and sign out
- ✅ **User profiles** - Extended user model with firstName, lastName, avatarUrl
- ✅ **Secure image proxy** - Private S3 images served through API proxy
- ✅ **Avatar management** - Upload, crop, and manage user avatars
- ✅ **Profile editing** - Edit mode with form validation and save functionality
- ✅ **Enhanced Signup Flow** - Guided username setup with validation and redirects
- ✅ **Username Validation** - Real-time username availability checking
- ✅ **Signup Guards** - Automatic redirect to complete profile setup
- ✅ **Real-time Profile Updates** - Instant UI updates after profile changes

### **User Interface & Experience**
- ✅ **Modern design** - Responsive navigation, light/dark theme, Figma-inspired dark mode
- ✅ **Mobile-first** - Optimized for all screen sizes with touch-friendly interactions
- ✅ **Accessible** - Built with shadcn/ui primitives, ARIA labels, keyboard navigation
- ✅ **Smart UX** - Form confirmation dialogs, loading states, optimistic UI updates

### **Social Interactions**
- ✅ **Engagement** - Likes, comments, saves with optimistic UI and proper permissions
- ✅ **User profiles** - Public profiles at `/u/[username]`, personal dashboard at `/me`
- ✅ **Follow system** - Follow/unfollow users with social stats (followers, following, recipes)
- ✅ **Discovery** - User search, suggested creators, clickable author info
- ✅ **Notifications** - Real-time bell icon with auto-read on page view (30s polling)

### **Collections & Saved Recipes**
- ✅ **Save recipes** - Automatic "Saved" collection with save/unsave toggle and dedicated `/saved` page

### **Advanced Nutrition & Health Scoring**
- ✅ **USDA database** - 300,000+ food items with comprehensive nutrition data
- ✅ **Health Score V2** - Protein density, macro balance, fiber bonus, sugar penalty algorithm
- ✅ **Smart mapping** - Automatic + manual ingredient-to-food mapping with confidence scores
- ✅ **Real-time impact** - Live preview of nutrition changes and health score updates
- ✅ **Community ingredients** - Users can create custom foods with auto-alias generation

### **Food Database & Search**
- ✅ **USDA import** - 300K+ foods with deduplication, category mapping, and data validation
- ✅ **Smart search** - Intelligent alias system, query normalization, and context-aware ranking
- ✅ **Community foods** - Users create custom ingredients with auto-mapping and deletion controls
### **Discovery & Feeds**
- ✅ **Home page** - Trending recipes (4-day recency decay), suggested creators, For You/Following feeds
- ✅ **Smart feeds** - Personalized For You (tag-based), Following, Most Popular (interaction scoring)
- ✅ **Recipe similarity** - "Also viewed" recommendations using co-view analysis with cold-start fallback

### **Engagement & Analytics**
- ✅ **View tracking** - Anonymous session tracking with 8-hour deduplication per recipe
- ✅ **Interaction scoring** - Automated scoring: 0.2×views + 1.0×likes + 2.0×comments + 0.6×saves
- ✅ **Cron jobs** - Nightly rollup for interaction scores, similarity graph builder

## 🚀 Quick Start

1) **Clone and install**
```bash
git clone <your-repo-url>
cd recipe-app
npm install

# Install additional dependencies for shadcn/ui components
npm install @radix-ui/react-slot @radix-ui/react-checkbox class-variance-authority clsx tailwind-merge @tailwindcss/line-clamp react-hook-form lucide-react
```

2) **Configure environment**
Create `.env` file with:
```bash
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/recipe_app"

# AWS S3 Configuration (Required)
AWS_REGION="us-east-2"
S3_BUCKET="your-bucket-name"
AWS_ACCESS_KEY_ID="your-access-key"
AWS_SECRET_ACCESS_KEY="your-secret-key"

# CloudFront CDN Configuration (Highly Recommended for Production)
# Server-side URL builder (used by getCdnImageUrl in lib/cdn.ts)
CLOUDFRONT_IMAGE_BASE="https://d3abc123xyz0.cloudfront.net"
# Client-side hostname (for preconnect and next.config.ts remotePatterns)
NEXT_PUBLIC_CLOUDFRONT_HOST="d3abc123xyz0.cloudfront.net"

# Legacy (deprecated - use CLOUDFRONT_IMAGE_BASE instead)
# S3_PUBLIC_BASE_URL="https://your-cloudfront-domain.com"

# Supabase Configuration (Required for Authentication & RLS)
NEXT_PUBLIC_SUPABASE_URL="https://your-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-anon-key"
SUPABASE_URL="https://your-project.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
```

3) **S3 Bucket Setup**
Configure CORS for localhost development:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT"],
    "AllowedOrigins": ["http://localhost:3000"],
    "ExposeHeaders": ["ETag"]
  }
]
```

4) **Database setup**
```bash
npm run prisma:generate
npm run prisma:migrate
```

5) **Set up Supabase Auth**
- Enable Email authentication in your Supabase dashboard
- Configure Google OAuth provider (optional)
- Apply RLS policies from `supabase-rls-policies.sql`

6) **Start development server**
```bash
npm run dev
```

7) **Open your browser**
Visit `http://localhost:3000` to start creating recipes!
- Sign in with email/password or Google OAuth
- Create your first recipe
- Test authentication with `/api/whoami`

## 🏗️ Architecture

### **Frontend**
- **Next.js 15** with App Router for server-side rendering
- **React Hook Form** for form state management
- **Zod** for runtime type validation
- **Tailwind CSS** for styling with design tokens
- **shadcn/ui** for accessible UI components

### **Backend**
- **Prisma ORM** for type-safe database operations
- **PostgreSQL** for data persistence
- **Supabase Auth** for secure authentication
- **AWS S3** for secure file storage
- **Next.js API Routes** for serverless functions
- **Row Level Security (RLS)** for database-level security

### **Image Delivery Architecture**

**Modern CloudFront Flow (Recommended):**
1. **Upload:** Client → `/api/upload` → Presigned POST → Private S3 Bucket
2. **Serving:** CloudFront CDN (OAC) → Private S3 Bucket
3. **URL Builder:** `getCdnImageUrl()` from `lib/cdn.ts` generates direct CloudFront URLs
4. **Performance:** 
   - Direct CDN serving (no serverless proxy)
   - Priority loading for first 3 images only
   - Automatic preconnect and DNS prefetch
   - 60s ISR caching for home page
   - Expected LCP improvement: 500-1000ms

**Legacy API Proxy Flow (Deprecated):**
- ⚠️ **Fallback only** when `CLOUDFRONT_IMAGE_BASE` is not configured
- Routes through `/api/image/[...key]` serverless function
- Adds 200-500ms latency per image
- Significantly impacts LCP/FCP metrics
- Should only be used during development

**Setup CloudFront for Production:**
1. Create CloudFront distribution pointing to your S3 bucket
2. Configure Origin Access Control (OAC) for private bucket access
3. Set `CLOUDFRONT_IMAGE_BASE` and `NEXT_PUBLIC_CLOUDFRONT_HOST` environment variables
4. Deploy and verify images load from CloudFront domain (not `/api/image/`)

**Image Optimization Features:**
- Automatic dimension detection for responsive images
- Next.js Image component with proper `sizes` attribute
- Priority loading for above-the-fold content only
- Blur placeholder support for better perceived performance
- WebP conversion and EXIF orientation handling

## 🔒 Security Implementation

### **Row Level Security (RLS)**
This app implements comprehensive database security using Supabase Row Level Security:

**Security Model:** Public read access for recipes/comments, owner-only write access, automatic RLS enforcement at database level for User, Recipe, Ingredient, Photo, Nutrition, Comment, Like, Collection, and CollectionRecipe models.

**Key Models:** Recipe, Ingredient, Photo, Nutrition, Comment, Like, Follow, Collection, Food, FoodAlias, IngredientFoodMap, RecipeView, RecipeInteractionDaily, RecipeSimilar, RecipeFeatureLite, Notification - all with proper indexes, unique constraints, and RLS policies.

**Recipe Deletion:** Owner validation, cascade cleanup (ingredients, photos, nutrition, comments, likes), S3 cleanup, atomic transactions. Supports single and bulk deletion.


## 🧪 API Endpoints

### **Recipe Management**
```bash
# Create a recipe
POST /api/recipes
{
  "title": "Banana Oats",
  "servings": 2,
  "bodyMd": "Mix ingredients and enjoy!",
  "ingredients": [
    {"name": "rolled oats", "qty": 100, "unit": "g"},
    {"name": "banana", "qty": 1, "unit": "unit"}
  ],
  "photos": [
    {"s3Key": "uploads/123-image.jpg", "width": 800, "height": 600}
  ]
}

# List recipes
GET /api/recipes

# Get recipe details
GET /api/recipes/[id]

# Update a recipe (owner only)
PATCH /api/recipes/[id]
{
  "title": "Updated Recipe Title",
  "servings": 4,
  "bodyMd": "Updated instructions...",
  "ingredients": [
    {"name": "updated ingredient", "qty": 2, "unit": "cups"}
  ],
  "tags": ["updated", "tags"]
}

# Delete a recipe (owner only)
DELETE /api/recipes/[id]

# Bulk delete recipes (owner only)
DELETE /api/recipes/bulk-delete
{
  "recipeIds": ["recipe1", "recipe2", "recipe3"]
}
```

### **Likes & Comments**
```bash
# Like a recipe (auth required)
POST /api/recipes/[id]/like
# Response: { "liked": true, "count": number }

# Unlike a recipe (auth required)
DELETE /api/recipes/[id]/like
# Response: { "liked": false, "count": number }

# Create a comment (auth required)
POST /api/recipes/[id]/comments
Body: { "body": string }  # Zod-validated: 1..500 chars
# Response: { id, body, createdAt, user: { id, name } }

# Delete a comment (author or recipe author)
DELETE /api/comments/[id]
# Response: 204 No Content

# Edit a comment (author only)
PATCH /api/comments/[id]
Body: { "body": string }  # Zod-validated: 1..500 chars
# Response: { id, body, createdAt, user: { id, name } }
```

### **Saved Collections**
```bash
# Save a recipe to user's "Saved" collection (auth required)
POST /api/recipes/[id]/save
# Response: { "saved": true, "count": number }

# Remove a recipe from user's "Saved" collection (auth required)
DELETE /api/recipes/[id]/save
# Response: { "saved": false, "count": number }

# Get user's saved recipes (auth required)
GET /saved
# Returns: Saved recipes page with user's saved collection
```

### **User Management & Social Features**
```bash
# Search users by username or display name
GET /api/users/search?q=username
# Response: [{ id, username, displayName, avatarKey }]

# Get user profile by username
GET /api/users/[username]
# Response: { id, username, displayName, bio, avatarKey, counts: { followers, following, recipes, likesReceived } }

# Follow a user (auth required)
POST /api/follow/[userId]
# Response: { "following": true, "followersCount": number }

# Unfollow a user (auth required)
DELETE /api/follow/[userId]
# Response: { "following": false, "followersCount": number }

# Check follow status (auth required)
GET /api/follow/state?userId=[userId]
# Response: { "following": boolean, "followersCount": number }

# Get suggested creators for discovery (auth required)
GET /api/discover/suggest-creators
# Response: { items: [{ id, name, username, image, mutualFollowers: [...], totalMutualFollowers: number }] }

# Get popular recipes for discovery
GET /api/discover/popular
# Response: { items: [{ id, title, createdAt, photos: [...], author: {...}, tags: [...], _count: {...} }] }

# Update user profile (auth required)
PATCH /api/account
{
  "firstName": "John",
  "lastName": "Doe", 
  "username": "johndoe",
  "bio": "Food enthusiast",
  "avatarUrl": "https://...",
  "avatarKey": "uploads/avatar.jpg"
}
# Response: { "success": true }

# Check username availability
GET /api/users/search?exact=username
# Response: [] (empty if available) or [{ username, ... }] (if taken)

# Delete user account (auth required)
DELETE /api/account/delete
# Response: { success: true, message: "Account and all associated data deleted successfully" }
# Note: This deletes ALL user data including recipes, comments, likes, collections, follows, etc.

# Get user profile by username (public)
GET /u/[username]
# Returns: User profile page with recipes, stats, and follow button
# Note: Users accessing their own profile are redirected to /me

# Enhanced /me page with social stats
GET /me
# Returns: Personal dashboard with followers, following, uploaded, and saved counts
```

### **Notifications**
```bash
# Get notifications with pagination (auth required)
GET /api/notifications?after=2023-01-01T00:00:00Z&limit=20
# Response: [{ id, type, createdAt, readAt, actor: { id, username, displayName, avatarKey }, recipe: { id, title }, comment: { id, body } }]

# Mark notifications as read (auth required)
POST /api/notifications/read
{
  "ids": ["notif1", "notif2"]  # Optional: specific notification IDs
}
# Response: { "ok": true, "unread": number }

# Get unread notification count (auth required)
GET /api/notifications/unread-count
# Response: { "unread": number }

# Notifications page
GET /notifications
# Returns: Notifications page with server-side rendering and auto-read functionality
```

#### Permissions & Behavior
- Never trust client `userId`; the server uses the authenticated user.
- Like actions are idempotent; duplicate likes are ignored server-side.
- Comment create/edit uses `commentBodySchema` (Zod) for validation.
- Delete comment is allowed by comment author or the recipe author.
- Edit comment is allowed only by the comment author.
- Unauthenticated like attempts return 401; the UI displays a sign-in notice.
- Save actions are idempotent; duplicate saves are ignored server-side.
- Each user gets an automatic "Saved" collection created on first save.
- Unauthenticated save attempts show popup prompts instead of API calls.
- Saved recipes are displayed on dedicated `/saved` page with authentication required.
- Follow button is visible to all users; non-logged-in users are redirected to login.
- Users accessing their own profile (`/u/username`) are automatically redirected to `/me`.
- Follow actions are idempotent; duplicate follows are ignored server-side.
- Follow button shows helpful tooltip for non-logged-in users: "Sign in to follow this user".
- Notifications are automatically created when users interact with content (follow, like, comment, save).
- Notification creation is idempotent; duplicate notifications are prevented server-side.
- Notifications are automatically marked as read when viewing the notifications page.
- Bell icon polls every 30 seconds for unread count updates.

### **Image Upload**
```bash
# Get presigned upload URL
POST /api/upload
{
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "maxSizeMB": 15,
  "type": "recipe"  # or "avatar"
}

# Serve images (private)
GET /api/image/uploads/filename.webp
```

**Image Compression Features:**
- **Automatic compression** - All images are compressed before upload
- **WebP conversion** - Images converted to WebP format for optimal size
- **Recipe photos** - Compressed to 2048px max dimension, 82% quality
- **Avatar images** - Square cropped and compressed to 1024px, 85% quality
- **EXIF orientation** - Proper handling of image orientation
- **15MB limit** - Increased file size limit for all uploads

### **Tags & Search**
```bash
# Get popular tags for autocomplete
GET /api/tags
# Response: [{ id, slug, label, count }]

# Search tags with query
GET /api/tags?s=dessert
# Response: [{ id, slug, label, count }] (filtered by search term)

# Recipe search with tags
GET /recipes?q=chocolate&tags=dessert&tags=quick
# Searches across title, instructions, and tag labels
```

### **Engagement Tracking & Personalization**
```bash
# Track recipe view (automatic via IntersectionObserver)
POST /api/recipes/[id]/view
# Response: { ok: true }
# Note: Automatically called when recipe card is 50% visible for 600ms
# Deduplication: 8-hour window per (recipeId, sessionId)

# Get personalized For-You feed
GET /api/feed/foryou?limit=12&cursor=optional_cursor
# Response: { items: [{ id, title, createdAt, photos: [...], author: {...}, tags: [...], _count: {...} }], nextCursor }
# Note: Uses recent viewing history for personalization

# Get recipes sorted by interactions (Most Popular)
GET /recipes?sort=interactions
# Response: Recipes sorted by 14-day interaction score
# Score formula: 0.2×views + 1.0×likes + 2.0×comments + 0.6×saves

# Run nightly interaction rollup (cron job)
npm run rollup:interactions
# Processes yesterday's views, likes, comments, saves into daily scores

# Get similar recipes for a recipe
GET /api/recipes/[id]/similar
# Response: { items: [{ id, title, createdAt, photos: [...], author: {...}, tags: [...], _count: {...} }] }
# Note: Uses co-view graph data with cold-start fallback to similar tags

# Build recipe similarities (cron job)
npm run similar:build
# Processes last 30 days of views to build co-view similarity graph
```

### **Advanced Nutrition System**
```bash
# Get nutrition data for a recipe
GET /api/nutrition?recipeId=[id]
# Response: { calories, proteinG, carbsG, fatG, fiberG, sugarG, healthScore, score: { label, breakdown: { proteinDensity, macroBalance, fiber, sugar } } }

# Compute nutrition for a recipe (auth required)
POST /api/recipes/[id]/compute-nutrition
# Response: { success: true, nutrition: { ... } }

# Auto-map ingredients to food database (auth required)
POST /api/recipes/[id]/auto-map
# Response: { success: true, mapped: number }

# Get ingredients with nutrition data
GET /api/recipes/[id]/ingredients
# Response: [{ id, name, qty, unit, currentMapping: { food: { name, brand }, confidence, nutrition: { calories, proteinG, carbsG, fatG, fiberG, sugarG } } }]

# Search foods with nutrition data
GET /api/foods/search?q=whey&withImpact=true&recipeId=[id]
# Response: [{ id, name, brand, nutrition: { ... }, impact: { deltaCalories, deltaProtein, deltaCarbs, deltaFat, deltaFiber, deltaSugar, scoreChange } }]

# Map ingredient to food (auth required)
POST /api/foods/map
{
  "ingredientId": "ingredient_id",
  "foodId": "food_id",
  "confidence": 0.95
}
# Response: { success: true }

# Create new community ingredient (auth required)
POST /api/foods/quick-create
{
  "name": "Low Fat Ricotta Cheese",
  "brand": "Brand Name",
  "servingLabel": "1 cup",
  "grams": 250,
  "calories": 200,
  "protein": 15,
  "carbs": 8,
  "fat": 8,
  "fiber": 0,
  "sugar": 2
}
# Response: { success: true, foodId: "food_id" }

# Delete community ingredient (auth required, owner only)
DELETE /api/foods/[id]?recipeId=[recipeId]
# Response: { success: true, message: "Ingredient deleted successfully" }

# Add aliases to food (auth required)
POST /api/foods/[id]/aliases
{
  "aliases": ["fat free", "low fat", "reduced fat"]
}
# Response: { success: true }
```

### **USDA Data Import & Management**
```bash
# Import USDA Foundation dataset
npm run usda:saturate -- --file=./data/usda/fdc.jsonl

# Import specific food categories
npm run usda:saturate -- --file=./data/usda/fdc.jsonl --keywords="cheese,milk,whey,oil,flour"

# Generate aliases for all foods
npm run aliases:backfill:fast

# Get food statistics by source
GET /api/admin/food-stats
# Response: { usda: 15000, community: 500, template: 100, byCategory: { dairy: 2000, meat: 1500, ... } }
```

## 🔧 Development

### **Dependencies**
This project uses shadcn/ui components which require additional dependencies:
- `@radix-ui/react-slot` - For component composition
- `@radix-ui/react-checkbox` - For checkbox components
- `class-variance-authority` - For component variants
- `clsx` & `tailwind-merge` - For conditional styling
- `@tailwindcss/line-clamp` - Tailwind plugin for text truncation
- `react-hook-form` - Form handling
- `lucide-react` - Icon library

### **Account Deletion & Cleanup**
```bash
# Clean up orphaned user data (users deleted from Supabase Auth but still in database)
node cleanup-orphaned-users.js

# This script will:
# 1. Find users in database that don't exist in Supabase Auth
# 2. Show you the list of orphaned users
# 3. Optionally delete them with all associated data
```

Additional dependencies:
- `nanoid` - For generating unique IDs
- `zod` - Runtime type validation

### **Available Scripts**
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint          # Run ESLint
npm run typecheck    # Run TypeScript checks
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations

# USDA Data Import
npm run usda:saturate     # Import USDA food database
npm run usda:keywords     # Import specific food categories
npm run usda:smoke-test   # Run deduplication and category mapping tests

# Alias Management
npm run aliases:backfill      # Generate aliases for all foods (slower)
npm run aliases:backfill:fast # Generate aliases with bulk operations (faster)

# Data Management
npm run cleanup-orphaned-users  # Clean up orphaned user data
npm run features:backfill       # Backfill RecipeFeatureLite for existing recipes
npm run rollup:interactions     # Run nightly interaction score rollup
npm run similar:build           # Build recipe similarity graph from co-view data
```

### **Environment Variables**
| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `AWS_REGION` | AWS region for S3 | ✅ |
| `S3_BUCKET` | S3 bucket name | ✅ |
| `AWS_ACCESS_KEY_ID` | AWS access key | ✅ |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ |
| `SUPABASE_URL` | Supabase project URL (server) | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | ✅ |
| `S3_PUBLIC_BASE_URL` | CDN URL (optional) | ❌ |
| `HEALTH_SCORE_V2` | Enable Health Score V2 algorithm (0/1) | ❌ |
| `DEV_API_KEY` | Development API key for bypassing auth | ❌ |

## 🚀 Deployment

### **Prerequisites**
- PostgreSQL database
- AWS S3 bucket with proper IAM permissions
- Node.js 18+ environment

### **Production Setup**
1. **Set environment variables** in your deployment platform
2. **Run database migrations**: `npm run prisma:migrate`
3. **Build the application**: `npm run build`
4. **Start the server**: `npm run start`

### **AWS S3 Permissions**
Minimal IAM policy for S3 access:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

**Note:** The `s3:DeleteObject` permission is required for recipe deletion functionality.

## 🧪 Smoke Tests

PowerShell tests for API endpoints:
```powershell
# Test upload endpoint
$uploadBody = @{
    filename = "test.jpg"
    contentType = "image/jpeg"
    maxSizeMB = 10
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/upload" -Method POST -Body $uploadBody -ContentType "application/json"

# Test recipes endpoint
Invoke-RestMethod -Uri "http://localhost:3000/api/recipes" -Method GET
```


## 📝 Notes
- **Images:** Served via secure API proxy, automatic S3 cleanup on deletion
- **Forms:** Auto-saved drafts (localStorage), Zod validation, optimistic UI
- **Auth:** Supabase handles authentication, RLS enforces permissions at database level
- **Production:** Consider CloudFront CDN via `S3_PUBLIC_BASE_URL` for image serving

## 🆕 Recent Major Updates

- **Security enhancements** - Password strength validation, rate limiting, account lockout, security headers
- **Advanced nutrition system** - USDA database (300K+ foods), Health Score V2, smart mapping, community ingredients
- **Discovery & personalization** - For You feed, suggested creators, recipe similarity, engagement tracking
- **Enhanced UX** - Figma-inspired dark mode, responsive design, notifications system, avatar cropping
- **Technical improvements** - Connection pool optimization, error handling, OAuth fixes, performance tuning

## 🔒 Security Implementation Details

### Password Security
**Requirements Enforced:**
- Minimum 8 characters
- At least 1 uppercase letter (A-Z)
- At least 1 lowercase letter (a-z)  
- At least 1 number (0-9)
- At least 1 special character (!@#$%^&*...)
- zxcvbn strength score ≥ 2 (Fair)

**Features:**
- Real-time strength indicator with visual feedback
- Estimated crack time display
- Automatic bcrypt hashing by Supabase (never stored in plain text)
- Same requirements for password reset

### Rate Limiting & Brute Force Protection

| Endpoint | Limit | Window | Protection |
|----------|-------|--------|------------|
| `/api/auth/signup` | 3 attempts | 1 hour | Rate limiting |
| `/api/auth/signin` | 5 attempts | 15 min | Progressive delays + 15min lockout |
| `/api/auth/reset-password` | 3 attempts | 1 hour | Rate limiting |
| General API | 100 requests | 1 minute | Rate limiting |

**Account Lockout (Signin):**
1. Attempt 1: Normal processing
2. Attempt 2-5: Progressive delays (1s → 2s → 5s → 10s)
3. Attempt 6+: **15-minute account lockout**

### Security Headers (Applied via Middleware)

```typescript
X-Frame-Options: DENY                    // Prevents clickjacking
X-Content-Type-Options: nosniff          // Prevents MIME sniffing
X-XSS-Protection: 1; mode=block          // XSS protection
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy: [configured]    // Defense in depth
Strict-Transport-Security: max-age=63072000  // Force HTTPS (production)
```

### Email Verification Flow
1. User signs up with email/password
2. Verification email sent automatically
3. User clicks verification link
4. Email verified, account activated
5. User can now sign in

**Configuration:** Enable in Supabase Dashboard → Authentication → Settings → "Confirm email"

### Password Reset Flow
1. User requests reset at `/forgot-password`
2. Secure one-time token sent via email (valid 1 hour)
3. User clicks link → redirected to `/update-password`
4. User enters new password (must meet all requirements)
5. Password updated, session automatically established

### Account Deletion
**Endpoint:** `DELETE /api/account/delete`

**Process:**
1. Verify user authentication
2. Delete all user recipes
3. Delete all interactions (likes, comments, follows, saves)
4. Delete user from database
5. Delete from Supabase Auth (using service role key)
6. Clear all active sessions

**⚠️ WARNING:** Permanent and irreversible!

### Session Management
- JWT-based authentication via Supabase
- 1-hour token expiry with automatic refresh
- 30-day refresh token expiry
- httpOnly cookies prevent JavaScript access
- sameSite='lax' for CSRF protection
- Secure flag in production (HTTPS only)
- Anonymous session tracking via `ms_session` cookie (1 year)

### File Locations

```
Security Implementation:
├── src/lib/auth/
│   ├── password-validation.ts           # Password strength validation
│   ├── auth-rate-limiter.ts             # Account lockout system
│   ├── rate-limit.ts                    # Rate limiter core
│   └── with-rate-limit.ts               # Rate limit middleware helper
├── src/app/api/auth/
│   ├── signin/route.ts                  # Rate-limited login endpoint
│   ├── signup/route.ts                  # Rate-limited signup endpoint
│   └── reset-password/route.ts          # Rate-limited reset endpoint
├── src/components/auth/
│   ├── AuthCard.tsx                     # Main authentication UI
│   └── PasswordStrengthIndicator.tsx    # Real-time password strength
├── src/middleware.ts                     # Security headers
├── src/app/forgot-password/page.tsx     # Password reset request
└── src/app/update-password/page.tsx     # Password update form
```

### Testing Security Features

```bash
# Test password strength validation
# Try weak password - should reject
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"weak"}'

# Test rate limiting
# Make 4 signup attempts - 4th should be rate limited
for i in {1..4}; do
  curl -X POST http://localhost:3000/api/auth/signup \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"test$i@example.com\",\"password\":\"Test123!@#\"}"
done

# Test security headers
curl -I https://yourdomain.com | grep -i "x-frame-options\|x-xss\|content-security"

# Check rate limit status
curl http://localhost:3000/api/auth/signin
# Returns: { attempts, attemptsRemaining, lockedUntil }
```

### Production Deployment Checklist

- [ ] Enable email verification in Supabase Dashboard
- [ ] Configure redirect URLs for production domain
- [ ] Set `NODE_ENV=production` for HTTPS enforcement
- [ ] Verify HTTPS is enabled (automatic on Vercel/Netlify)
- [ ] Test all auth flows on production
- [ ] Verify security headers using [securityheaders.com](https://securityheaders.com)
- [ ] Review CSP policy for your specific needs
- [ ] Set up error monitoring/alerting
- [ ] Document security contact for vulnerability reports

### Additional Security Measures

**Input Sanitization:**
- All inputs validated with Zod schemas
- Email format validation
- Username validation (alphanumeric + underscores)
- Content length limits enforced
- Disposable email blocking

**API Security:**
- All routes require proper authentication
- Row-Level Security (RLS) policies in Supabase
- Users can only modify their own data
- Admin endpoints protected by service role keys

**Database Security:**
- Supabase RLS policies enforce data isolation
- Prisma prevents SQL injection
- Encrypted connections to database
- Connection pooling with pgBouncer
- Regular automated backups

## 📋 TODO - Next Development Phase

### **Enhanced Notifications**
- 🔲 **Real-time Notifications** - Implement WebSocket or Server-Sent Events for instant notifications
- 🔲 **Notification Settings** - Allow users to customize notification preferences
- 🔲 **Email Notifications** - Optional email notifications for important events
- 🔲 **Push Notifications** - Browser push notifications for real-time updates

### **Enhanced Social Features**
- 🔲 **Activity Feed** - Show activity from followed users
- 🔲 **User Recommendations** - Suggest users to follow based on interests
- 🔲 **Social Analytics** - Enhanced user profile analytics and engagement metrics
- 🔲 **User Mentions** - @username mentions in comments and recipes
- 🔲 **Social Sharing** - Share recipes on social media platforms

### **Advanced Search & Discovery**
- 🔲 **Search Results Page** - Dedicated search results page with filtering
- 🔲 **Search History** - Track and display recent searches
- 🔲 **Advanced Filters** - Filter by date, popularity, user, etc.
- 🔲 **Search Analytics** - Track popular searches and trending content

### **Content Management**
- 🔲 **Recipe Collections** - User-created collections beyond "Saved"
- 🔲 **Recipe Forks** - Fork and modify existing recipes
- 🔲 **Recipe Versioning** - Track changes and history of recipes
- 🔲 **Content Moderation** - Report and moderate inappropriate content

### **Performance & Analytics**
- 🔲 **Performance Monitoring** - Track page load times and user interactions
- 🔲 **User Analytics Dashboard** - Detailed analytics for recipe creators
- 🔲 **Search Analytics** - Track search patterns and popular content
- 🔲 **Engagement Metrics** - Like rates, comment rates, and user engagement
