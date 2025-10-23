"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const validation_1 = require("@/lib/validation");
const auth_1 = require("@/lib/auth");
const auto_map_1 = require("@/lib/nutrition/auto-map");
const compute_1 = require("@/lib/nutrition/compute");
async function POST(request) {
    try {
        const body = await request.json();
        // Debug logging
        console.log('Received photos in API:', body.photos);
        console.log('Number of photos received:', body.photos?.length || 0);
        // Validate the request body
        const validatedData = validation_1.recipeApiSchema.parse(body);
        // Get the authenticated user
        const author = await (0, auth_1.getCurrentUser)();
        if (!author) {
            return server_1.NextResponse.json({ success: false, error: "Authentication required" }, { status: 401 });
        }
        // Create the recipe with ingredients, photos, and tags
        const recipe = await db_1.prisma.recipe.create({
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
                        id: true,
                        name: true,
                        username: true,
                        displayName: true,
                        avatarKey: true,
                    },
                },
            },
        });
        // Handle tags if provided
        if (validatedData.tags && validatedData.tags.length > 0) {
            for (const tagLabel of validatedData.tags) {
                const slug = tagLabel.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                const humanizedLabel = tagLabel.trim();
                // Upsert tag
                const tag = await db_1.prisma.tag.upsert({
                    where: { slug },
                    update: {},
                    create: {
                        slug,
                        label: humanizedLabel
                    },
                });
                // Create recipe tag link
                await db_1.prisma.recipeTag.create({
                    data: {
                        recipeId: recipe.id,
                        tagId: tag.id,
                    }
                });
            }
        }
        // Auto-map ingredients to foods and compute nutrition
        try {
            const mappedCount = await (0, auto_map_1.autoMapIngredients)(recipe.id);
            console.log(`Auto-mapped ${mappedCount} ingredients for recipe ${recipe.id}`);
            // Compute nutrition after mapping ingredients
            await (0, compute_1.computeRecipeNutrition)(recipe.id, 'general');
            console.log(`Computed nutrition for recipe ${recipe.id}`);
        }
        catch (error) {
            console.error('Error auto-mapping ingredients or computing nutrition:', error);
            // Don't fail the recipe creation if auto-mapping fails
        }
        return server_1.NextResponse.json({
            success: true,
            recipe: { id: recipe.id }
        });
    }
    catch (error) {
        console.error("Error creating recipe:", error);
        if (error instanceof Error && error.name === "ZodError") {
            return server_1.NextResponse.json({ success: false, error: "Invalid form data" }, { status: 400 });
        }
        return server_1.NextResponse.json({ success: false, error: "Failed to create recipe" }, { status: 500 });
    }
}
