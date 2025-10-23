import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { deriveServingOptions } from '@/lib/units/servings';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    const f = await prisma.food.findUnique({
      where: { id },
      include: { units: true }
    });

    if (!f) {
      return NextResponse.json({ success: false, error: 'Food not found' }, { status: 404 });
    }

    const servingOptions = deriveServingOptions({
      units: f.units?.map(u => ({ label: u.label, grams: u.grams })),
      densityGml: f.densityGml ?? undefined,
      categoryId: f.categoryId ?? null,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: f.id,
        name: f.name,
        brand: f.brand,
        categoryId: f.categoryId,
        source: f.source,
        verification: f.verification,
        densityGml: f.densityGml,
        kcal100: f.kcal100,
        protein100: f.protein100,
        carbs100: f.carbs100,
        fat100: f.fat100,
        fiber100: f.fiber100,
        sugar100: f.sugar100,
        popularity: f.popularity,
        createdById: f.createdById,
        servingOptions,
      }
    });
  } catch (error) {
    console.error('Food by id error:', error);
    return NextResponse.json({ success: false, error: 'Failed to load food' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
    }

    // Get the recipe ID from query params to check if mappings are only to current recipe
    const { searchParams } = new URL(req.url);
    const recipeId = searchParams.get('recipeId');

    // Find the food and check if user can delete it
    const food = await prisma.food.findUnique({
      where: { id },
      include: {
        ingredientMaps: {
          include: {
            ingredient: {
              select: {
                recipeId: true,
                recipe: {
                  select: {
                    authorId: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!food) {
      return NextResponse.json({ success: false, error: 'Food not found' }, { status: 404 });
    }

    // Check if user can delete this food
    const canDelete = 
      food.source === 'community' && // It's a community food
      (food.createdById === user.id || food.createdById === null); // User created it OR it's a legacy ingredient (created before fix)

    console.log('Delete check:', {
      foodId: id,
      userId: user.id,
      createdById: food.createdById,
      source: food.source,
      canDelete
    });

    if (!canDelete) {
      return NextResponse.json({ 
        success: false, 
        error: `You can only delete community ingredients you created. Created by: ${food.createdById}, Current user: ${user.id}, Source: ${food.source}` 
      }, { status: 403 });
    }

    // Check if there are mappings to other users' recipes
    const mappingsToOtherRecipes = food.ingredientMaps.filter(mapping => 
      mapping.ingredient.recipe.authorId !== user.id
    );

    if (mappingsToOtherRecipes.length > 0) {
      return NextResponse.json({ 
        success: false, 
        error: 'Cannot delete ingredient that is mapped to other users\' recipes' 
      }, { status: 403 });
    }

    // If recipeId is provided, only allow deletion if all mappings are to that recipe
    if (recipeId) {
      const mappingsToOtherRecipes = food.ingredientMaps.filter(mapping => 
        mapping.ingredient.recipeId !== recipeId
      );

      if (mappingsToOtherRecipes.length > 0) {
        return NextResponse.json({ 
          success: false, 
          error: 'Cannot delete ingredient that is mapped to other recipes' 
        }, { status: 403 });
      }
    }

    // Delete the food (this will cascade delete related records)
    await prisma.food.delete({
      where: { id }
    });

    return NextResponse.json({ 
      success: true, 
      message: 'Ingredient deleted successfully' 
    });
  } catch (error) {
    console.error('Food deletion error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete food' },
      { status: 500 }
    );
  }
}