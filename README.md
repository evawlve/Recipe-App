# Recipe App (Next.js + Prisma + PostgreSQL + S3 + Supabase Auth)

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

## 🚀 Features

### **Recipe Management**
- ✅ **Create recipes** with title, servings, ingredients, and instructions
- ✅ **Image upload** with drag & drop interface
- ✅ **Ingredient management** with add/remove functionality
- ✅ **Recipe listing** with search and pagination
- ✅ **Recipe details** with full image gallery
- ✅ **Delete recipes** with secure ownership validation
- ✅ **Bulk delete** multiple recipes at once

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

## 🚀 Quick Start

1) **Clone and install**
```bash
git clone <your-repo-url>
cd recipe-app
npm install
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
- ✅ **Collection** - User-owned read/write
- ✅ **CollectionRecipe** - User-owned read/write (via collection)

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

# Delete a recipe (owner only)
DELETE /api/recipes/[id]

# Bulk delete recipes (owner only)
DELETE /api/recipes/bulk-delete
{
  "recipeIds": ["recipe1", "recipe2", "recipe3"]
}
```

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
