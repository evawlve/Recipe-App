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
- ✅ **Create recipes** with title, servings, ingredients, and instructions
- ✅ **Edit recipes** with full ownership validation and secure updates
- ✅ **Image upload** with drag & drop interface and automatic compression
- ✅ **Existing photo management** with individual removal capability
- ✅ **Ingredient management** with add/remove functionality
- ✅ **Recipe listing** with search and pagination
- ✅ **Recipe details** with full image gallery
- ✅ **Delete recipes** with secure ownership validation
- ✅ **Bulk delete** multiple recipes at once
- ✅ **Tag system** with autocomplete and filtering
- ✅ **Advanced search** across titles, instructions, and tags
- ✅ **Tag-based filtering** with popular tags display
- ✅ **Author discovery** - Clickable author avatars and names for user discovery

### **Form Experience**
- ✅ **React Hook Form + Zod** validation
- ✅ **Draft persistence** - never lose your work
- ✅ **Focus management** - automatic focus on invalid fields
- ✅ **Loading states** - visual feedback during operations
- ✅ **Error handling** - comprehensive error messages

### **Image Handling**
- ✅ **Secure S3 uploads** with presigned URLs
- ✅ **API proxy** for private image serving
- ✅ **Image optimization** with Next.js Image component
- ✅ **Multiple image support** per recipe
- ✅ **Automatic dimension detection**
- ✅ **Client-side image compression** - Automatic compression before upload
- ✅ **WebP conversion** - Convert all images to WebP format for optimal size
- ✅ **EXIF orientation support** - Proper image orientation handling
- ✅ **Avatar square cropping** - Automatic square cropping for profile pictures
- ✅ **15MB file size limit** - Increased limit for all uploads (recipes and avatars)

### **Authentication & Security**
- ✅ **Supabase Auth** - Email/password and Google OAuth authentication
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
- ✅ **Modern branding** - "Mealspire" with custom logo
- ✅ **Responsive navigation** - Mobile hamburger menu with desktop layout
- ✅ **Consistent color scheme** - Green primary buttons throughout
- ✅ **Logo integration** - Clickable logo linking to home page
- ✅ **Form confirmation dialogs** - Prevent accidental data loss
- ✅ **Mobile-first design** - Optimized for all screen sizes
- ✅ **Accessible components** - Built with shadcn/ui primitives
- ✅ **Theme support** - Light/dark mode with automatic switching
- ✅ **Modern navbar** - Clean design with search, notifications, and user avatar
- ✅ **Interactive avatar cropping** - Drag-to-position image cropping with preview
- ✅ **Profile management** - Edit profile with avatar upload and form validation

### **Social Interactions**
- ✅ **Likes** - Users can like/unlike recipes with optimistic UI
- ✅ **Comments** - Users can post, edit (own), and delete (own or recipe author)
- ✅ **Counts** - Recipe cards display like and comment counts
- ✅ **Auth-aware UX** - Unauthenticated likes show a sign-in notice
- ✅ **Real-time updates** - Optimistic UI with rollback on errors
- ✅ **Permission-based actions** - Edit only for comment authors, delete for authors or recipe owners
- ✅ **User Search** - Search for users by username or display name
- ✅ **User Profiles** - Public user profile pages with recipes and stats
- ✅ **Follow System** - Follow/unfollow other users with real-time updates
- ✅ **User Discovery** - Enhanced search with user suggestions
- ✅ **Profile Statistics** - Display follower count, following count, and recipe count
- ✅ **Follow Button for All Users** - Visible follow button for non-logged-in users (redirects to login)
- ✅ **Smart Profile Redirects** - Users accessing their own profile are redirected to /me page
- ✅ **Enhanced /me Page** - Personal dashboard with follower/following counts and complete stats

### **Notifications System**
- ✅ **Bell Icon with Unread Count** - Real-time notification count in navbar with polling
- ✅ **Notification Types** - Follow, like, comment, and save notifications
- ✅ **Auto-Read Functionality** - Notifications automatically marked as read when viewing page
- ✅ **User Discovery** - Clickable user avatars and names for profile discovery
- ✅ **Smart Navigation** - Click notifications to navigate to relevant content
- ✅ **Dark Mode Support** - Proper text readability in both light and dark themes
- ✅ **Responsive Design** - Works seamlessly on all screen sizes
- ✅ **Real-time Polling** - Bell icon polls every 30 seconds for unread count
- ✅ **Notification Creation** - Automatic notifications when users interact with content
- ✅ **Database Schema** - Complete notification model with proper relations and indexes

### **Collections & Saved Recipes**
- ✅ **Saved Collections** - Automatic "Saved" collection created per user
- ✅ **Save/Unsave Recipes** - Toggle save status with optimistic UI updates
- ✅ **Saved Recipes Page** - Dedicated `/saved` page to view all saved recipes
- ✅ **Recipe Card Integration** - Save buttons on recipe cards and detail pages
- ✅ **Auth-aware Save UI** - Unauthenticated users see sign-in prompts
- ✅ **Smart Popup Positioning** - Responsive popups that work on all screen sizes
- ✅ **Collection Management** - Server-side collection creation and management

### **Advanced Nutrition & Health Scoring**
- ✅ **Comprehensive Nutrition Database** - USDA food database with 300,000+ food items
- ✅ **Health Score V2 Algorithm** - Advanced scoring based on protein density, macro balance, fiber bonus, and sugar penalty
- ✅ **Feature Flagging** - Environment-controlled switching between scoring algorithms
- ✅ **Automatic Ingredient Mapping** - AI-powered ingredient-to-food matching with confidence scores
- ✅ **Manual Ingredient Mapping** - User-controlled ingredient mapping with search and selection
- ✅ **Real-time Impact Preview** - Shows how ingredient changes affect nutrition and health score
- ✅ **Nutrition Breakdown Modal** - Detailed per-ingredient nutrition display with badges
- ✅ **Protein Density Tracking** - Calculates protein density per 100 calories
- ✅ **Macro Balance Analysis** - Evaluates carbohydrate, protein, and fat ratios
- ✅ **Fiber & Sugar Scoring** - Bonus points for fiber, penalty for excess sugar
- ✅ **Unit Conversion System** - Automatic conversion between units (cups, tablespoons, grams, etc.)
- ✅ **Per-Serving Calculations** - Accurate nutrition scaling based on recipe servings
- ✅ **Color-coded Health Scores** - Visual indicators for health score components
- ✅ **Ingredient Mapping Persistence** - Mappings preserved across recipe saves
- ✅ **Edit Mappings from Recipe Page** - Direct navigation from nutrition breakdown to edit page
- ✅ **Mobile-Responsive Nutrition Display** - Optimized nutrition display for all screen sizes

### **USDA Food Database Saturation System**
- ✅ **USDA Data Import** - Automated import of USDA FoodData Central datasets (Foundation, SR Legacy, FNDDS)
- ✅ **Smart Filtering** - Intelligent filtering to include only generic foods (excludes branded, baby, supplement items)
- ✅ **Category Mapping** - Automatic mapping of USDA foods to internal categories (dairy, meat, oil, flour, etc.)
- ✅ **Deduplication System** - Advanced deduplication using canonical names and macro fingerprints
- ✅ **Bulk Import Process** - Efficient bulk import with progress tracking and error handling
- ✅ **Data Normalization** - Standardized nutrition data per 100g across all food items
- ✅ **Keyword-Focused Imports** - Targeted imports for specific food categories (cheese, milk, whey, etc.)
- ✅ **Import Statistics** - Detailed reporting of imported foods by source and category
- ✅ **Smoke Testing** - Comprehensive test suite for deduplication and category mapping
- ✅ **Data Quality Validation** - Plausibility checks for nutritional data (calorie ranges, macro ratios)

### **Advanced Food Search & Alias System**
- ✅ **Intelligent Alias Generation** - Automatic generation of food aliases for better searchability
- ✅ **Fat Modifier Aliases** - Smart aliases for fat-related terms (nonfat, fat-free, part-skim, reduced fat, light, etc.)
- ✅ **Cheese & Dairy Aliases** - Comprehensive alias system for cheese and dairy products with modifier permutations
- ✅ **Milk Product Aliases** - Specific aliases for milk products (nonfat milk, skim milk, 2% milk, etc.)
- ✅ **Whey & Protein Aliases** - Protein powder aliases (whey protein, protein powder, whey isolate, etc.)
- ✅ **Flour & Starch Aliases** - Powder synonyms for flour and starch products
- ✅ **Query Normalization** - Smart query normalization that collapses synonyms (fat-free → nonfat, part-skim → part skim)
- ✅ **Enhanced Search Ranking** - Advanced ranking algorithm with exact alias matching and category boosts
- ✅ **Processed Food De-ranking** - Intelligent de-ranking of processed foods when searching for basic ingredients
- ✅ **Basic Ingredient Prioritization** - Raw and fresh ingredients rank higher than processed alternatives
- ✅ **Bulk Alias Backfill** - Efficient bulk alias generation for existing foods with pagination and skipDuplicates
- ✅ **Search Race Condition Fixes** - Resolved search result flickering with proper timeout management
- ✅ **Category-Based Ranking** - Category hints boost relevant foods (cheese queries prefer cheese category)
- ✅ **Composite Dish De-ranking** - Mixed dishes rank lower unless specifically requested
- ✅ **Exact Alias Matching** - Hard promotion for exact normalized alias matches
- ✅ **Modifier-Head Coverage** - Medium boost for modifier + head-noun combinations (nonfat + cheese)

### **Community Ingredient Creation & Management**
- ✅ **Create New Ingredient Button** - Users can create custom ingredients directly from the mapping modal
- ✅ **Ingredient Creation Form** - Comprehensive form with required fields (name, serving size, calories, protein, carbs, fats) and optional fields (fiber, sugar)
- ✅ **Auto-mapping on Creation** - Newly created ingredients are automatically mapped to the source ingredient
- ✅ **Community Labeling** - All user-created ingredients are tagged with "community" source
- ✅ **Auto-aliases Generation** - Automatic alias creation for fat-related terms (nonfat, low fat, reduced fat, etc.)
- ✅ **Ingredient Deletion** - Users can delete ingredients they created themselves
- ✅ **Deletion Authorization** - Only community ingredients created by the user can be deleted
- ✅ **Mapping Validation** - Prevents deletion of ingredients mapped to other users' recipes
- ✅ **Legacy Data Support** - Handles legacy community ingredients with proper deletion permissions
- ✅ **Nutrition Auto-computation** - Automatic nutrition recomputation after ingredient mappings are saved
- ✅ **Persistent Mappings** - Ingredient mappings are properly saved and persist across modal sessions
- ✅ **Enhanced UX** - Improved input field handling with easy placeholder deletion
- ✅ **Database Schema Updates** - Enhanced Food model with createdById, source, and verification fields
### **Home MVP & Discovery**
- ✅ **Home Page MVP** - Complete home page with trending recipes, category browsing, and search
- ✅ **Trending Recipes Algorithm** - Advanced scoring based on likes, comments, and recency decay (4-day half-life)
- ✅ **Horizontal Recipe Rail** - Smooth scrolling carousel with navigation chevrons for desktop
- ✅ **Category Tile System** - Browse by meal type (breakfast, lunch, dinner, snacks, desserts, drinks)
- ✅ **Deep Linking** - URL-based navigation with query parameters for search and filtering
- ✅ **Search Bar Integration** - Full-width search bar on home page with deep-linking to recipes
- ✅ **Recipe Page Search** - Dedicated search bar on recipes page with URL state synchronization
- ✅ **Advanced Search** - Search across recipe titles, body content, and ingredient names
- ✅ **Responsive Design** - Mobile-first design with proper breakpoints and touch interactions
- ✅ **Accessibility Features** - ARIA labels, keyboard navigation, and screen reader support
- ✅ **Performance Optimization** - Efficient database queries with RecipeFeatureLite for fast ranking
- ✅ **Visual Consistency** - Unified search bar styling and color schemes across pages
- ✅ **Like Button Enhancement** - Green accent color for liked recipes with ThumbsUp icon
- ✅ **User Experience** - Clear visual feedback, loading states, and error handling

### **Tag System & Search**
- ✅ **Tag input** with autocomplete suggestions from existing tags
- ✅ **Tag chips** with visual display and easy removal
- ✅ **Tag normalization** - automatic slug generation and duplicate prevention
- ✅ **Popular tags** display with usage counts
- ✅ **Tag-based filtering** - filter recipes by one or multiple tags
- ✅ **Advanced search** - search across recipe titles, instructions, and tag labels
- ✅ **Search persistence** - URL state management for search and filters
- ✅ **Quick navigation** - "View All Recipes" button to clear filters
- ✅ **Tag Namespaces & Sources** - Structured tag system with namespaces (MEAL_TYPE, CUISINE, DIET, METHOD, COURSE, TIME, DIFFICULTY, OCCASION, GOAL) and sources (USER, AUTO_CONFIDENT, AUTO_SUGGESTED)
- ✅ **Guided Recipe Creation** - Required meal type selection with optional taxonomy chips for Cuisine, Method, and Diet
- ✅ **Auto-suggestions System** - AI-powered tag suggestions based on recipe nutrition and text analysis
- ✅ **Recipe Feature Lite** - Pre-computed macro features for fast filtering and sorting
- ✅ **Smart Goal Classification** - Advanced pre-workout/post-workout classification with tie-breaker logic
- ✅ **Diet Classification** - Regex-based diet suggestions (vegetarian, vegan, gluten-free, dairy-free, nut-free, high-protein)
- ✅ **Method & Cuisine Detection** - Text-based method and cuisine classification
- ✅ **Suggestion Acceptance Flow** - Users can accept auto-suggested tags with confidence scoring

### **User Management & Discovery**
- ✅ **Enhanced Signup Process** - Guided username setup with real-time validation
- ✅ **Username Requirements** - 3-20 characters, lowercase letters, numbers, underscores only
- ✅ **Real-time Username Validation** - Instant availability checking with debouncing
- ✅ **Signup Guards** - Automatic redirect to complete profile setup before accessing app
- ✅ **Profile Completion Flow** - Users must set username before accessing main features
- ✅ **User Search API** - Search users by username or display name with pagination
- ✅ **User Profile Pages** - Public profiles at `/u/[username]` with recipes and stats
- ✅ **Follow System** - Follow/unfollow users with optimistic UI updates
- ✅ **User Statistics** - Display follower count, following count, and recipe count
- ✅ **Enhanced Search Box** - Search both users and recipes with suggestions
- ✅ **Profile Management** - Real-time profile updates without page refresh
- ✅ **Avatar Management** - Upload and crop avatars with automatic compression and square cropping
- ✅ **Smart Profile Navigation** - Users accessing their own profile are redirected to /me
- ✅ **Enhanced Personal Dashboard** - /me page shows complete social stats (followers/following)
- ✅ **Universal Follow Button** - Follow button visible to all users (redirects non-logged-in users to login)
- ✅ **Complete Account Deletion** - Delete account with full data cleanup and auth removal
- ✅ **Username Persistence** - Usernames preserved across sign-ins and OAuth flows
- ✅ **Orphaned Data Cleanup** - Scripts to clean up orphaned user data
- ✅ **JWT Token Management** - Proper session cleanup after account deletion
- ✅ **Author Discovery** - Clickable author information in recipe cards and pages
- ✅ **Enhanced User Search** - Search results redirect to /me for current user, /u/[username] for others

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

# Optional: CDN URL (leave empty for API proxy)
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

### **S3 Image Flow**
- **Private S3 bucket** - images not publicly accessible
- **Presigned POST uploads** via `/api/upload` endpoint
- **API proxy serving** via `/api/image/[...key]` for private access
- **Automatic dimension detection** for responsive images
- **Next.js Image optimization** for performance

## 🔒 Security Implementation

### **Row Level Security (RLS)**
This app implements comprehensive database security using Supabase Row Level Security:

#### **Security Model:**
- **Public Read Access** - Anyone can view recipes, ingredients, photos, comments
- **Owner-Only Write Access** - Users can only create/modify their own content
- **Authentication Required** - All write operations require valid user sessions
- **Automatic Authorization** - RLS policies enforce permissions at the database level

#### **Protected Operations:**
```sql
-- Users can only modify their own recipes
"authorId" = public.current_app_user_id()

-- Users can only modify their own comments
"userId" = public.current_app_user_id()

-- Users can only access their own collections
"userId" = public.current_app_user_id()
```

#### **RLS Policies Applied To:**
- ✅ **User** - Self-access only
- ✅ **Recipe** - Public read, owner-only write
- ✅ **Ingredient** - Public read, owner-only write (via recipe)
- ✅ **Photo** - Public read, owner-only write (via recipe)
- ✅ **Nutrition** - Public read, owner-only write (via recipe)
- ✅ **Comment** - Public read, user-owned write
- ✅ **Like** - Public read, user-owned write
- ✅ **Collection** - User-owned read/write with unique constraint (userId, name)
- ✅ **CollectionRecipe** - User-owned read/write (via collection)

#### **Database Schema Updates:**
- ✅ **Collection Model** - Stores user collections with unique constraint on (userId, name)
- ✅ **CollectionRecipe Model** - Junction table linking collections to recipes
- ✅ **Unique Constraints** - Prevents duplicate collections per user
- ✅ **Automatic Collection Creation** - "Saved" collection created per user on first save
- ✅ **Cascade Deletion** - CollectionRecipe entries cleaned up when recipes are deleted
- ✅ **Food Model** - USDA food database with nutrition data (kcal100, protein100, carbs100, fat100, fiber100, sugar100)
- ✅ **IngredientFoodMap Model** - Links ingredients to foods with confidence scores
- ✅ **Nutrition Model** - Stores computed nutrition data per recipe with health scores
- ✅ **Food Aliases** - Alternative names for foods to improve ingredient mapping
- ✅ **Enhanced Nutrition Fields** - Added fiberG, sugarG, healthScore to nutrition calculations
- ✅ **Community Food Support** - Enhanced Food model with createdById, source, and verification fields
- ✅ **Food Deletion System** - Proper authorization for community ingredient deletion
- ✅ **Legacy Data Handling** - Support for legacy community ingredients with null createdById
- ✅ **Auto-alias Generation** - Automatic alias creation based on ingredient name patterns
- ✅ **Mapping Persistence** - Enhanced mapping system with proper state management
- ✅ **Error Handling Improvements** - Enhanced Supabase server client with fallback mechanisms and comprehensive error handling
- ✅ **React Component Stability** - Fixed unique key prop issues in ingredient mapping components

#### **USDA Database Schema:**
- ✅ **Food Model Enhancements** - Added source field (usda, community, template) and verification field
- ✅ **FoodAlias Model** - New model for food aliases with unique constraint on (foodId, alias) and index on alias
- ✅ **USDA Data Fields** - Added fdcId, dataType, and category fields for USDA data tracking
- ✅ **Deduplication Support** - Canonical name and macro fingerprint fields for deduplication
- ✅ **Category Mapping** - Automatic category assignment based on USDA food descriptions
- ✅ **Bulk Import Optimization** - Database indexes optimized for bulk insert operations
- ✅ **Alias Performance** - Indexed alias field for fast search operations
- ✅ **Data Integrity** - Unique constraints prevent duplicate aliases and ensure data consistency

### **Recipe Deletion System**

#### **Single Recipe Deletion:**
- **Owner validation** - Only recipe authors can delete
- **Cascade cleanup** - Removes all related data (ingredients, photos, nutrition, etc.)
- **S3 cleanup** - Automatically deletes associated images from S3
- **Transaction safety** - Atomic operation ensures data consistency

#### **Bulk Deletion:**
- **Batch processing** - Delete multiple recipes efficiently
- **Owner validation** - Only deletes recipes owned by the user
- **Selective UI** - Users can choose which recipes to delete
- **Confirmation dialog** - Prevents accidental deletions

#### **Deletion Flow:**
```typescript
// 1. Validate ownership
if (recipe.authorId !== user.id) {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

// 2. Delete S3 images
await s3.send(new DeleteObjectsCommand({
  Bucket: bucket,
  Delete: { Objects: recipe.photos.map(p => ({ Key: p.s3Key })) }
}));

// 3. Delete database records (atomic transaction)
await prisma.$transaction([
  prisma.photo.deleteMany({ where: { recipeId: id } }),
  prisma.ingredient.deleteMany({ where: { recipeId: id } }),
  prisma.comment.deleteMany({ where: { recipeId: id } }),
  prisma.like.deleteMany({ where: { recipeId: id } }),
  prisma.recipeTag.deleteMany({ where: { recipeId: id } }),
  prisma.collectionRecipe.deleteMany({ where: { recipeId: id } }),
  prisma.nutrition.deleteMany({ where: { recipeId: id } }),
  prisma.recipe.delete({ where: { id } })
]);
```

## 🔐 Authentication Features

### **Sign In Options**
- **Email/Password** - Traditional authentication with automatic signup
- **Google OAuth** - One-click sign in with Google account
- **Session Management** - Secure server-side session validation
- **Auto-redirect** - Seamless flow to intended pages after signin

### **Security Features**
- **Row Level Security (RLS)** - Database-level access control
- **Owner-only operations** - Users can only modify their own content
- **Public recipe viewing** - Anyone can browse recipes (social features)
- **Protected routes** - Automatic redirect to signin for protected pages
- **Auth state display** - Real-time authentication status in header

### **API Authentication**
```bash
# Check authentication status
GET /api/whoami
# Returns: { id, email, name } or 401 if not authenticated

# All recipe operations require authentication
POST /api/recipes          # Create recipe (auth required)
PATCH /api/recipes/[id]    # Update recipe (owner only)
DELETE /api/recipes/[id]   # Delete recipe (owner only)
DELETE /api/recipes/bulk-delete  # Bulk delete (owner only)
```

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

## 🔐 Security Benefits

### **Database Security:**
- **Row Level Security** prevents unauthorized data access
- **Automatic permission enforcement** at the database level
- **No application-level security bypasses** possible
- **Audit trail** of all database operations

### **Data Protection:**
- **User data isolation** - Users can only access their own content
- **Public content sharing** - Recipes are viewable by everyone (social features)
- **Secure deletion** - Complete cleanup of user data and associated files
- **Transaction safety** - Atomic operations prevent data corruption

### **Authentication & Authorization:**
- **Supabase Auth integration** - Email/password and Google OAuth
- **JWT-based security** - Stateless authentication with secure validation
- **Session management** - Server-side session validation for security
- **OAuth callback handling** - Proper Google OAuth flow implementation
- **Page guards** - Protected routes with automatic redirects
- **Auth state display** - Real-time authentication status in header
- **Multi-provider support** - Easy to add more OAuth providers

## 📝 Notes
- Images are served through a secure API proxy to keep S3 private
- Form drafts are automatically saved to localStorage
- The nutrition API is a stub - replace with your preferred data source
- For production, consider using CloudFront with `S3_PUBLIC_BASE_URL`
- **RLS policies** are automatically applied to all database operations
- **S3 cleanup** happens automatically when recipes are deleted
- **User authentication** is handled by Supabase Auth with OAuth support
- **Google OAuth** requires proper callback URL configuration in Supabase
- **Session security** uses server-side validation for maximum security
- **Protected routes** automatically redirect unauthenticated users to signin
- **Recipe editing** includes ownership validation and secure updates
- **Modern UI** features responsive navigation and consistent branding
- **Form validation** uses Zod schemas for both create and update operations
- **Photo management** allows individual photo removal during editing
- **Social features** include likes and comments with proper permission controls
- **Optimistic UI** provides instant feedback for likes and comments
- **Comment editing** is restricted to comment authors only
- **Comment deletion** is allowed for comment authors or recipe owners
- **Like counts** and **comment counts** are displayed on recipe cards
- **Unauthenticated users** see sign-in prompts when trying to like recipes
- **Saved Collections** feature with automatic "Saved" collection per user
- **Save/Unsave functionality** with optimistic UI updates on recipe cards and detail pages
- **Dedicated /saved page** for viewing all saved recipes (authentication required)
- **Smart popup positioning** - Responsive popups that work on all screen sizes without overflow
- **Improved comment UX** - Clean "Sign in to comment" button for unauthenticated users
- **"No comments yet" placeholder** - Clear indication when no comments exist
- **Separated Comments section** - Comments now have their own dedicated Card section
- **Tag system** provides comprehensive recipe categorization and discovery
- **Advanced search** enables finding recipes by title, instructions, or tags
- **Tag filtering** allows users to browse recipes by specific categories
- **Autocomplete suggestions** help users discover existing tags
- **URL state management** preserves search and filter states for sharing
- **Google OAuth display name preservation** ensures custom names aren't overridden by OAuth metadata
- **Recipe navigation fixes** resolve NEXT_NOT_FOUND errors and avatar display issues in recipe cards
- **Complete data structure** ensures all recipe components receive proper data for navigation and display

## 🆕 Recent Updates

### **USDA Food Database & Advanced Search System**
- ✅ **USDA Data Saturation** - Complete import system for USDA FoodData Central datasets with smart filtering and deduplication
- ✅ **Intelligent Alias System** - Advanced alias generation for fat modifiers, cheese/dairy products, and protein powders
- ✅ **Query Normalization** - Smart query processing that collapses synonyms (fat-free → nonfat, part-skim → part skim)
- ✅ **Enhanced Search Ranking** - Sophisticated ranking algorithm with exact alias matching and category boosts
- ✅ **Processed Food De-ranking** - Intelligent de-ranking of processed foods when searching for basic ingredients
- ✅ **Bulk Alias Backfill** - Efficient bulk alias generation with pagination and skipDuplicates optimization
- ✅ **Search Race Condition Fixes** - Resolved search result flickering with proper timeout management
- ✅ **Category-Based Ranking** - Category hints boost relevant foods (cheese queries prefer cheese category)
- ✅ **Composite Dish De-ranking** - Mixed dishes rank lower unless specifically requested
- ✅ **Exact Alias Matching** - Hard promotion for exact normalized alias matches
- ✅ **Modifier-Head Coverage** - Medium boost for modifier + head-noun combinations (nonfat + cheese)
- ✅ **Data Quality Validation** - Plausibility checks for nutritional data and macro ratios
- ✅ **Import Statistics** - Detailed reporting of imported foods by source and category
- ✅ **Smoke Testing** - Comprehensive test suite for deduplication and category mapping

### **Enhanced User Experience**
- ✅ **Modern Navbar Design** - Clean, Figma-inspired navigation with search bar, notifications, and user avatar
- ✅ **Theme Support** - Full light/dark mode support with automatic theme switching
- ✅ **Figma-Inspired Dark Mode** - New dark mode color scheme based on Figma design with warm brown palette
- ✅ **Interactive Avatar Cropping** - Drag-to-position image cropping with real-time preview
- ✅ **Profile Management** - Complete user profile editing with avatar upload and form validation
- ✅ **Secure Image Proxy** - Private S3 images served through secure API proxy
- ✅ **Enhanced Authentication** - Improved sign-out flow with proper error handling
- ✅ **Mobile-Responsive Design** - Optimized navigation and components for all screen sizes
- ✅ **Enhanced Signup Flow** - Guided username setup with real-time validation and redirects
- ✅ **User Search & Discovery** - Search for users by username or display name with suggestions
- ✅ **Follow System** - Follow/unfollow other users with real-time UI updates
- ✅ **User Profile Pages** - Public user profiles with recipes, stats, and follow functionality
- ✅ **Real-time Profile Updates** - Instant UI updates after profile changes without page refresh
- ✅ **Signup Guards** - Automatic redirect to complete profile setup before accessing main app
- ✅ **Enhanced Search Box** - Search both users and recipes with dropdown suggestions
- ✅ **Disabled UI During Signup** - Navigation and search disabled with helpful tooltips during setup
- ✅ **Complete Account Deletion** - Full user data cleanup with database and auth removal
- ✅ **Username Persistence Fix** - Resolved OAuth callback overwriting usernames
- ✅ **JWT Token Management** - Proper session cleanup after account deletion
- ✅ **Orphaned Data Cleanup** - Scripts to identify and clean up orphaned user data

### **Authentication & Display Name Fixes**
- ✅ **Google OAuth Display Name Preservation** - Fixed issue where Google OAuth was overriding custom display names
- ✅ **Custom Name Protection** - Users' custom display names are now preserved across Google OAuth sign-ins
- ✅ **OAuth Metadata Handling** - Improved OAuth callback to only update empty fields, not override existing user data
- ✅ **Profile Data Integrity** - Ensured user profile data remains consistent across authentication methods

### **Recipe Navigation & UI Fixes**
- ✅ **Recipe Card Navigation Fix** - Resolved NEXT_NOT_FOUND errors when clicking recipes from /me page
- ✅ **Complete Recipe Data Structure** - Fixed incomplete recipe objects that were causing navigation failures
- ✅ **Avatar Display in Recipe Cards** - Fixed avatar display issues in recipe cards by including complete author data
- ✅ **Enhanced Recipe Grid Component** - Updated RecipeGrid to pass complete author data and current user context
- ✅ **Improved Recipe Card Data Flow** - Ensured recipe cards receive all required data for proper navigation and display

### **User Discovery & Navigation Enhancements**
- ✅ **Clickable Author Information** - Author avatars, names, and usernames are now clickable in recipe cards and pages
- ✅ **Smart Profile Navigation** - Clicking on your own author info redirects to /me, others redirect to their profile
- ✅ **Enhanced Author Display** - Author avatars and usernames are visible and clickable for better user discovery
- ✅ **Fallback Avatar System** - Users without avatars see colored circles with their initials
- ✅ **Consistent Author Data** - All recipe displays now include complete author information (id, username, displayName, avatarKey)
- ✅ **Server Component Compliance** - Fixed nested anchor tag issues by using client components for clickable author links

### **Profile & Social System Enhancements**
- ✅ **Smart Profile Redirects** - Users accessing their own profile (`/u/username`) are automatically redirected to `/me`
- ✅ **Enhanced /me Page** - Personal dashboard now displays complete social statistics (followers, following, uploaded, saved)
- ✅ **Universal Follow Button** - Follow button is now visible to all users, including non-logged-in users
- ✅ **Login Redirect for Follow** - Non-logged-in users clicking follow are redirected to login page with helpful tooltip
- ✅ **Complete Social Stats** - /me page shows follower count, following count, uploaded recipes, and saved recipes
- ✅ **Improved User Discovery** - Better user experience for discovering and following other users
- ✅ **Seamless Navigation** - Users always see the appropriate version of their profile (public vs. personal dashboard)

### **Technical Improvements**
- ✅ **Database Schema Updates** - Added firstName, lastName, username, displayName, bio, avatarUrl, avatarKey fields to User model
- ✅ **API Enhancements** - New user management, follow system, and account management endpoints
- ✅ **Image Upload System** - Secure S3 uploads with presigned URLs and API proxy serving
- ✅ **Form Validation** - Enhanced form handling with Zod schemas and error states
- ✅ **Theme Integration** - Consistent theme-aware styling throughout the application
- ✅ **User Search API** - Search users by username or display name with pagination
- ✅ **Follow System API** - Complete follow/unfollow functionality with optimistic UI
- ✅ **Profile Management API** - Real-time profile updates with instant UI feedback
- ✅ **Username Validation** - Real-time username availability checking with debouncing
- ✅ **Signup Flow Guards** - Automatic redirect system for incomplete profiles
- ✅ **Enhanced Authentication** - Improved user session management and profile completion flow
- ✅ **Supabase Server Client Fixes** - Resolved server-side client initialization errors with proper error handling and fallback mechanisms
- ✅ **React Key Prop Fixes** - Fixed unique key prop warnings in ingredient mapping lists with fallback key generation

### **Search & Alias System Architecture**
- ✅ **Query Normalization Engine** - Smart query processing with synonym collapsing and punctuation simplification
- ✅ **Alias Generation Rules** - Comprehensive rule system for fat modifiers, cheese/dairy, and protein products
- ✅ **Bulk Alias Backfill** - Optimized bulk alias generation with pagination and skipDuplicates
- ✅ **Search Ranking Algorithm** - Advanced ranking with exact alias matching, category boosts, and processed food de-ranking
- ✅ **Race Condition Resolution** - Proper timeout management for debounced search operations
- ✅ **Database Indexing** - Optimized indexes for alias search performance
- ✅ **Data Integrity** - Unique constraints and proper error handling for alias operations
- ✅ **Performance Optimization** - Efficient bulk operations and pagination for large datasets
- ✅ **Test Coverage** - Comprehensive test suite for alias generation and search ranking
- ✅ **Error Handling** - Robust error handling for Supabase server-side client initialization

### **Image Compression & Optimization**
- ✅ **Client-side Image Compression** - Automatic compression before upload using Canvas API
- ✅ **WebP Conversion** - All images converted to WebP format for optimal file size
- ✅ **EXIF Orientation Support** - Proper handling of image orientation using createImageBitmap
- ✅ **Avatar Square Cropping** - Automatic square cropping for profile pictures
- ✅ **Quality Optimization** - Different compression settings for recipes (82% quality) vs avatars (85% quality)
- ✅ **File Size Reduction** - Typical 80-90% size reduction (20MB → 1-2MB)
- ✅ **15MB Upload Limit** - Increased file size limit for all uploads (recipes and avatars)
- ✅ **Enhanced File Support** - Support for JPEG, PNG, WebP, and HEIC formats
- ✅ **Automatic Dimension Detection** - Compressed images include accurate width/height metadata

### **Advanced Nutrition & Health Scoring System**
- ✅ **Health Score V2 Implementation** - Revolutionary nutrition scoring algorithm with protein density, macro balance, fiber bonus, and sugar penalty
- ✅ **Feature Flag System** - Environment-controlled switching between scoring algorithms (HEALTH_SCORE_V2 flag)
- ✅ **USDA Food Database Integration** - Comprehensive nutrition database with 300,000+ food items
- ✅ **Automatic Ingredient Mapping** - AI-powered ingredient-to-food matching with confidence scoring
- ✅ **Manual Ingredient Mapping** - User-controlled ingredient mapping with search and selection interface
- ✅ **Real-time Impact Preview** - Live calculation of how ingredient changes affect nutrition and health score
- ✅ **Nutrition Breakdown Modal** - Detailed per-ingredient nutrition display with health badges
- ✅ **Protein Density Analysis** - Calculates protein density per 100 calories for health optimization
- ✅ **Macro Balance Evaluation** - Analyzes carbohydrate, protein, and fat ratios for balanced nutrition
- ✅ **Fiber & Sugar Scoring** - Bonus points for fiber content, penalty for excess sugar
- ✅ **Comprehensive Unit Conversion** - Automatic conversion between cups, tablespoons, grams, scoops, etc.
- ✅ **Per-Serving Nutrition Scaling** - Accurate nutrition calculations based on recipe serving sizes
- ✅ **Color-coded Health Indicators** - Visual health score components with green/yellow/red coding
- ✅ **Ingredient Mapping Persistence** - Mappings preserved across recipe saves and updates
- ✅ **Edit Mappings from Recipe Page** - Direct navigation from nutrition breakdown to edit page with auto-opened mapping modal
- ✅ **Mobile-Responsive Nutrition Display** - Optimized nutrition display for all screen sizes (768px+ breakpoints)
- ✅ **Nutrition API Endpoints** - Complete API for nutrition computation, ingredient mapping, and food search
- ✅ **Unit Tests for Scoring** - Comprehensive test coverage for health scoring algorithms
- ✅ **Impact Preview API** - Real-time impact calculation for ingredient changes
- ✅ **Food Search with Impact** - Search foods with real-time impact preview on recipe nutrition

### **Responsive Design & Mobile Optimization**
- ✅ **Mobile-First Recipe Layout** - Optimized recipe page layout for mobile devices (768px+ breakpoints)
- ✅ **Responsive Navigation** - Hamburger menu for screens 768px-1024px, desktop navigation for larger screens
- ✅ **Mobile Nutrition Display** - Nutrition breakdown shown after photos on mobile/tablet screens
- ✅ **Desktop Sidebar Layout** - Nutrition sidebar for desktop screens (1280px+)
- ✅ **Adaptive Component Sizing** - Components automatically adjust to screen size
- ✅ **Touch-Friendly Interface** - Optimized button sizes and spacing for mobile interaction
- ✅ **Flexible Grid Layouts** - Responsive grid systems that work across all device sizes

### **Notifications System MVP**
- ✅ **Complete Notifications Infrastructure** - Full notification system with database schema, API routes, and UI components
- ✅ **Bell Icon with Unread Count** - Real-time notification count in navbar with 30-second polling
- ✅ **Notification Types** - Follow, like, comment, and save notifications automatically created
- ✅ **Smart Navigation** - Click notifications to navigate to relevant content (follow → /me, like/comment/save → recipe)
- ✅ **User Discovery** - Clickable user avatars and names for profile discovery
- ✅ **Auto-Read Functionality** - Notifications automatically marked as read when viewing page
- ✅ **Dark Mode Support** - Proper text readability in both light and dark themes
- ✅ **Responsive Design** - Works seamlessly on all screen sizes
- ✅ **Database Schema** - Complete notification model with proper relations and indexes
- ✅ **API Endpoints** - GET /api/notifications, POST /api/notifications/read, GET /api/notifications/unread-count
- ✅ **Server-Side Rendering** - Notifications page with server-side data fetching
- ✅ **Real-time Polling** - Bell icon polls every 30 seconds and on window focus
- ✅ **Notification Creation** - Automatic notifications when users interact with content
- ✅ **Proper Avatar Display** - User avatars display correctly using /api/image/ route
- ✅ **No Nested Links** - Fixed HTML validation issues with proper click handlers

### **Community Ingredient Creation & Management System**
- ✅ **Create New Ingredient Feature** - Users can create custom ingredients directly from the ingredient mapping modal
- ✅ **Comprehensive Creation Form** - Form with required fields (name, serving size, calories, protein, carbs, fats) and optional fields (fiber, sugar)
- ✅ **Auto-mapping Integration** - Newly created ingredients are automatically mapped to the source ingredient
- ✅ **Community Labeling System** - All user-created ingredients are tagged with "community" source for identification
- ✅ **Smart Auto-aliases** - Automatic alias generation for fat-related terms (nonfat, low fat, reduced fat, light, lean)
- ✅ **Ingredient Deletion System** - Users can delete ingredients they created with proper authorization
- ✅ **Deletion Authorization** - Only community ingredients created by the user can be deleted
- ✅ **Mapping Validation** - Prevents deletion of ingredients mapped to other users' recipes
- ✅ **Legacy Data Support** - Handles legacy community ingredients with null createdById
- ✅ **Nutrition Auto-computation** - Automatic nutrition recomputation after ingredient mappings are saved
- ✅ **Persistent Mappings** - Ingredient mappings are properly saved and persist across modal sessions
- ✅ **Enhanced UX** - Improved input field handling with easy placeholder deletion for numeric fields
- ✅ **Database Schema Updates** - Enhanced Food model with createdById, source, and verification fields
- ✅ **API Endpoints** - New endpoints for ingredient creation, deletion, and alias management
- ✅ **Authorization System** - Proper user ownership validation for community ingredient management
- ✅ **Auto-alias Patterns** - Smart pattern matching for fat-related terms with comprehensive alias generation

### **PR3 - Auto-suggestions & Recipe Feature Lite System**
- ✅ **Tag Namespaces & Sources** - Complete tag system restructure with namespaces (MEAL_TYPE, CUISINE, DIET, METHOD, COURSE, TIME, DIFFICULTY, OCCASION, GOAL) and sources (USER, AUTO_CONFIDENT, AUTO_SUGGESTED)
- ✅ **Guided Recipe Creation Flow** - Required meal type selection with optional taxonomy chips for Cuisine, Method, and Diet during recipe creation
- ✅ **RecipeFeatureLite Model** - New database model for pre-computed macro features (proteinPer100kcal, carbPer100kcal, fatPer100kcal, fiberPerServing, sugarPerServing, kcalPerServing)
- ✅ **Auto-suggestion Classifiers** - AI-powered suggestion system with diet, method, cuisine, and goal classification
- ✅ **Diet Classification Engine** - Regex-based diet detection (vegetarian, vegan, gluten-free, dairy-free, nut-free, high-protein) with nutrition thresholds
- ✅ **Smart Goal Classification** - Advanced pre-workout/post-workout classification with protein:carb ratio tie-breaker logic
- ✅ **Method & Cuisine Detection** - Text-based classification for cooking methods (air fry, bake, grill) and cuisines (Mexican, Italian, American)
- ✅ **Feature Writer Service** - Automatic computation and caching of recipe features on creation/update
- ✅ **Suggestion API Endpoints** - Real-time suggestion generation and acceptance with confidence scoring
- ✅ **SuggestionCard Component** - Interactive UI for displaying and accepting auto-suggested tags
- ✅ **Backfill Script** - Comprehensive script to populate RecipeFeatureLite for existing recipes
- ✅ **Database Migration** - Schema updates with RecipeFeatureLite model and relations
- ✅ **Enhanced Tag Seeds** - Extended tag database with diet, method, cuisine, and goal tags
- ✅ **Integration with Recipe Creation** - Automatic feature computation during recipe creation flow

### **Figma-Inspired Dark Mode Color Scheme**
- ✅ **New Dark Mode Palette** - Implemented warm brown color scheme based on Figma design (#211412, #472B24, #C99E91, #FFFFFF, #E5E8EB)
- ✅ **Search Bar Styling** - Updated search components with new dark brown backgrounds and proper text colors
- ✅ **Preserved Green Accents** - Maintained green accent colors for buttons and ingredient selection backgrounds
- ✅ **CSS Color Tokens** - Updated semantic color variables for consistent theming across components
- ✅ **Tailwind Integration** - Added new search-specific color classes for Figma design compliance
- ✅ **Component Updates** - Updated homepage search bar and enhanced search box with new color scheme
- ✅ **Accessibility Maintained** - Ensured proper contrast ratios and readability in new dark mode
- ✅ **Green Selection Preservation** - Kept beautiful green selection backgrounds in ingredient mapping modal

### **Home MVP & Search Enhancement System**
- ✅ **Home MVP Implementation** - Complete home page with trending recipes, category browsing, and search functionality
- ✅ **Trending Algorithm** - Advanced scoring system based on likes, comments, and recency decay with 4-day half-life
- ✅ **Horizontal Recipe Rail** - Smooth scrolling trending recipes carousel with navigation chevrons
- ✅ **Category Tile System** - Browse by meal type with deep-linking to filtered recipe pages
- ✅ **Search Bar Integration** - Full-width search bar on home page with deep-linking to recipes page
- ✅ **Recipe Page Search** - Dedicated search bar on recipes page with URL state synchronization
- ✅ **Search Functionality** - Advanced search across recipe titles, body content, and ingredient names
- ✅ **Tag System Integration** - Added "drinks" tag to meal type categories with proper API ordering
- ✅ **Responsive Design** - Mobile-first design with proper breakpoints and touch-friendly interactions
- ✅ **Accessibility Features** - Proper ARIA labels, keyboard navigation, and screen reader support
- ✅ **Performance Optimization** - Efficient database queries with RecipeFeatureLite for fast ranking
- ✅ **Deep Linking** - URL-based navigation with query parameters for search and filtering
- ✅ **Visual Consistency** - Unified search bar styling across home and recipes pages
- ✅ **Like Button Enhancement** - Green accent color for liked recipes with ThumbsUp icon
- ✅ **User Experience** - Clear visual feedback, loading states, and error handling

### **Recent Bug Fixes & Stability Improvements**
- ✅ **Supabase Server Client Error Resolution** - Fixed "Cannot read properties of undefined (reading 'call')" errors in server-side Supabase client initialization
- ✅ **Enhanced Error Handling** - Added comprehensive error handling and fallback mechanisms for Supabase server client creation
- ✅ **Cookie Operation Safety** - Added try-catch blocks around all cookie operations to prevent server crashes
- ✅ **Environment Variable Validation** - Added proper validation for Supabase environment variables with clear error messages
- ✅ **React Key Prop Warnings** - Fixed "Each child in a list should have a unique key prop" warnings in ingredient mapping lists
- ✅ **Fallback Key Generation** - Implemented fallback key generation using array index when ingredient IDs are missing or duplicate
- ✅ **Development Server Stability** - Improved server restart process with cache clearing for clean module loading
- ✅ **Module Loading Optimization** - Enhanced webpack module loading for Supabase SSR client to prevent initialization failures

### **Database Connection Pool Optimization**
- ✅ **Prisma Connection Pool Timeout Fixes** - Resolved P2024 connection pool timeout errors with enhanced Prisma client configuration
- ✅ **Retry Logic Implementation** - Added automatic retry mechanism for database operations with exponential backoff
- ✅ **Connection Pool Configuration** - Enhanced Prisma client with proper timeout settings (60s connect, 30s query)
- ✅ **Graceful Shutdown Handlers** - Added proper connection cleanup on process termination
- ✅ **Database Operation Resilience** - All database operations now use retry logic for connection pool timeouts
- ✅ **Error Code Handling** - Specific handling for P2024 (connection pool timeout) errors with automatic retry
- ✅ **Connection Management** - Improved connection lifecycle management to prevent pool exhaustion
- ✅ **Fallback Mechanisms** - Enhanced error handling with fallback database operations for critical user flows

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
