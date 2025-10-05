import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recipeApiSchema } from "@/lib/validation";
import { getCurrentUser } from "@/lib/auth";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Debug logging
    console.log('Received photos in API:', body.photos);
    console.log('Number of photos received:', body.photos?.length || 0);
    
    // Validate the request body
    const validatedData = recipeApiSchema.parse(body);
    
    // Get the authenticated user
    const author = await getCurrentUser();
    
    if (!author) {
      return NextResponse.json(
        { success: false, error: "Authentication required" },
        { status: 401 }
      );
    }
    
    // Create the recipe with ingredients and photos
    const recipe = await prisma.recipe.create({
      data: {
        title: validatedData.title,
        servings: validatedData.servings,
        bodyMd: validatedData.bodyMd,
        authorId: author.id,
        ingredients: {
          create: validatedData.ingredients.map(ingredient => ({
            name: ingredient.name,
            qty: ingredient.qty,
            unit: ingredient.unit,
          })),
        },
        photos: {
          create: validatedData.photos.map(photo => ({
            s3Key: photo.s3Key,
            width: photo.width,
            height: photo.height,
          })),
        },
      },
      include: {
        author: {
          select: {
            name: true,
          },
        },
      },
    });
    
    return NextResponse.json({ 
      success: true, 
      recipe: { id: recipe.id } 
    });
  } catch (error) {
    console.error("Error creating recipe:", error);
    
    if (error instanceof Error && error.name === "ZodError") {
      return NextResponse.json(
        { success: false, error: "Invalid form data" },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { success: false, error: "Failed to create recipe" },
      { status: 500 }
    );
  }
}