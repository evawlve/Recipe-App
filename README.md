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
- ✅ **Image upload** with drag & drop interface
- ✅ **Existing photo management** with individual removal capability
- ✅ **Ingredient management** with add/remove functionality
- ✅ **Recipe listing** with search and pagination
- ✅ **Recipe details** with full image gallery
- ✅ **Delete recipes** with secure ownership validation
- ✅ **Bulk delete** multiple recipes at once
- ✅ **Tag system** with autocomplete and filtering
- ✅ **Advanced search** across titles, instructions, and tags
- ✅ **Tag-based filtering** with popular tags display

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

### **Collections & Saved Recipes**
- ✅ **Saved Collections** - Automatic "Saved" collection created per user
- ✅ **Save/Unsave Recipes** - Toggle save status with optimistic UI updates
- ✅ **Saved Recipes Page** - Dedicated `/saved` page to view all saved recipes
- ✅ **Recipe Card Integration** - Save buttons on recipe cards and detail pages
- ✅ **Auth-aware Save UI** - Unauthenticated users see sign-in prompts
- ✅ **Smart Popup Positioning** - Responsive popups that work on all screen sizes
- ✅ **Collection Management** - Server-side collection creation and management
### **Tag System & Search**
- ✅ **Tag input** with autocomplete suggestions from existing tags
- ✅ **Tag chips** with visual display and easy removal
- ✅ **Tag normalization** - automatic slug generation and duplicate prevention
- ✅ **Popular tags** display with usage counts
- ✅ **Tag-based filtering** - filter recipes by one or multiple tags
- ✅ **Advanced search** - search across recipe titles, instructions, and tag labels
- ✅ **Search persistence** - URL state management for search and filters
- ✅ **Quick navigation** - "View All Recipes" button to clear filters

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

### **Image Upload**
```bash
# Get presigned upload URL
POST /api/upload
{
  "filename": "photo.jpg",
  "contentType": "image/jpeg",
  "maxSizeMB": 10
}

# Serve images (private)
GET /api/image/uploads/filename.jpg
```

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

### **Nutrition (Stub)**
```bash
# Calculate nutrition (placeholder)
POST /api/nutrition
{
  "items": [
    {"name": "rolled oats", "qty": 100, "unit": "g"},
    {"name": "banana", "qty": 1, "unit": "unit"}
  ]
}
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
- `nanoid` - For generating unique IDs
- `zod` - Runtime type validation

### **Available Scripts**
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run typecheck    # Run TypeScript checks
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Run database migrations
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

## 🆕 Recent Updates

### **Enhanced User Experience**
- ✅ **Modern Navbar Design** - Clean, Figma-inspired navigation with search bar, notifications, and user avatar
- ✅ **Theme Support** - Full light/dark mode support with automatic theme switching
- ✅ **Interactive Avatar Cropping** - Drag-to-position image cropping with real-time preview
- ✅ **Profile Management** - Complete user profile editing with avatar upload and form validation
- ✅ **Secure Image Proxy** - Private S3 images served through secure API proxy
- ✅ **Enhanced Authentication** - Improved sign-out flow with proper error handling
- ✅ **Mobile-Responsive Design** - Optimized navigation and components for all screen sizes

### **Technical Improvements**
- ✅ **Database Schema Updates** - Added firstName, lastName, avatarUrl, avatarKey fields to User model
- ✅ **API Enhancements** - New account management endpoints with validation
- ✅ **Image Upload System** - Secure S3 uploads with presigned URLs and API proxy serving
- ✅ **Form Validation** - Enhanced form handling with Zod schemas and error states
- ✅ **Theme Integration** - Consistent theme-aware styling throughout the application

## 📋 TODO - Next Development Phase

### **User Management & Social Features**
- 🔲 **Unique Display Names** - Implement unique display name validation with @username format
- 🔲 **User Search** - Add user search functionality to the navbar search bar
- 🔲 **User Profiles** - Display unique display names with @ symbol (e.g., @username)
- 🔲 **Follow System** - Implement user following/followers functionality
- 🔲 **User Analytics** - Show like counts, comment counts, and engagement metrics on user profiles

### **Search & Discovery**
- 🔲 **Advanced Search** - Implement search functionality for both users and recipes
- 🔲 **Search Results** - Create dedicated search results page with filtering
- 🔲 **Search Suggestions** - Add autocomplete and search suggestions
- 🔲 **Search History** - Track and display recent searches

### **Notifications System**
- 🔲 **Notification Center** - Wire up the notifications button in the navbar
- 🔲 **Real-time Notifications** - Implement real-time notification system
- 🔲 **Notification Types** - Like notifications, comment notifications, follow notifications
- 🔲 **Notification Settings** - Allow users to customize notification preferences

### **Enhanced Social Features**
- 🔲 **User Following** - Follow/unfollow other users
- 🔲 **Activity Feed** - Show activity from followed users
- 🔲 **User Recommendations** - Suggest users to follow based on interests
- 🔲 **Social Analytics** - Enhanced user profile analytics and engagement metrics
