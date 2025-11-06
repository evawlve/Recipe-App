import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import EditRecipeForm from "./EditRecipeForm";

interface EditRecipePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditRecipePage({ params }: EditRecipePageProps) {
  const resolvedParams = await params;
  const currentUser = await getCurrentUser();
  
  if (!currentUser) {
    redirect("/signin");
  }

  // Load recipe with all related data
  const recipe = await prisma.recipe.findUnique({
    where: {
      id: resolvedParams.id,
    },
    include: {
      photos: {
        select: {
          id: true,
          s3Key: true,
          width: true,
          height: true,
          isMainPhoto: true,
        },
        orderBy: [{ isMainPhoto: 'desc' }, { id: 'asc' }],
      },
      ingredients: {
        select: {
          id: true,
          name: true,
          qty: true,
          unit: true,
        },
      },
      tags: {
        select: {
          tag: {
            select: {
              label: true,
            },
          },
        },
      },
    },
  });

  if (!recipe) {
    notFound();
  }

  // Check if current user is the author
  if (currentUser.id !== recipe.authorId) {
    redirect(`/recipes/${recipe.id}`);
  }

  // Transform data for the form
  const formData = {
    title: recipe.title,
    servings: recipe.servings,
    bodyMd: recipe.bodyMd,
    prepTime: recipe.prepTime as "<15 min" | "15-30 min" | "30-45 min" | "45min - 1hr" | "1hr+" | undefined,
    ingredients: recipe.ingredients.map(ing => ({
      id: ing.id,
      name: ing.name,
      qty: ing.qty,
      unit: ing.unit,
    })),
    tags: recipe.tags.map(rt => rt.tag.label),
    photos: recipe.photos.map(photo => ({
      id: photo.id,
      s3Key: photo.s3Key,
      width: photo.width,
      height: photo.height,
      isMainPhoto: photo.isMainPhoto,
    })),
  };

  return (
    <EditRecipeForm 
      recipeId={recipe.id}
      initialData={formData}
    />
  );
}
