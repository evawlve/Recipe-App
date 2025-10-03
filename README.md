# Recipe App (Next.js + Prisma + PostgreSQL + S3)

A full-featured recipe management application with:
- **Next.js 15** (App Router, TypeScript)
- **Prisma + PostgreSQL** for data persistence
- **AWS S3** for secure image storage with API proxy
- **React Hook Form + Zod** for form validation
- **Tailwind CSS + shadcn/ui** for modern UI
- **Image upload with drag & drop** functionality
- **Draft persistence** with localStorage
- **Responsive design** with mobile-first approach

## 🚀 Features

### **Recipe Management**
- ✅ **Create recipes** with title, servings, ingredients, and instructions
- ✅ **Image upload** with drag & drop interface
- ✅ **Ingredient management** with add/remove functionality
- ✅ **Recipe listing** with search and pagination
- ✅ **Recipe details** with full image gallery

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

### **Technical Features**
- ✅ **TypeScript** throughout
- ✅ **Server-side rendering** with Next.js 15
- ✅ **Database migrations** with Prisma
- ✅ **Responsive design** with Tailwind CSS
- ✅ **Modern UI components** with shadcn/ui

## 🛠️ Quickstart

1) **Clone & install**
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

5) **Start development server**
```bash
npm run dev
```

6) **Open your browser**
Visit `http://localhost:3000` to start creating recipes!

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
- **AWS S3** for secure file storage
- **Next.js API Routes** for serverless functions

### **S3 Image Flow**
- **Private S3 bucket** - images not publicly accessible
- **Presigned POST uploads** via `/api/upload` endpoint
- **API proxy serving** via `/api/image/[...key]` for private access
- **Automatic dimension detection** for responsive images
- **Next.js Image optimization** for performance

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
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

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
- Images are served through a secure API proxy to keep S3 private
- Form drafts are automatically saved to localStorage
- The nutrition API is a stub - replace with your preferred data source
- For production, consider using CloudFront with `S3_PUBLIC_BASE_URL`
