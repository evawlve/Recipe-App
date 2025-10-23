"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const client_s3_1 = require("@aws-sdk/client-s3");
exports.runtime = "nodejs";
async function DELETE(request) {
    try {
        const body = await request.json();
        const { recipeIds } = body;
        if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
            return server_1.NextResponse.json({ error: "Invalid recipe IDs" }, { status: 400 });
        }
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const region = process.env.AWS_REGION;
        const bucket = process.env.S3_BUCKET;
        if (!region || !bucket) {
            return server_1.NextResponse.json({ error: "Missing AWS_REGION or S3_BUCKET" }, { status: 500 });
        }
        // Get all recipes that belong to the current user
        const recipes = await db_1.prisma.recipe.findMany({
            where: {
                id: { in: recipeIds },
                authorId: user.id, // Only allow deleting own recipes
            },
            include: { photos: true },
        });
        if (recipes.length === 0) {
            return server_1.NextResponse.json({ error: "No recipes found or not authorized" }, { status: 404 });
        }
        // Collect all S3 keys for deletion
        const allS3Keys = recipes.flatMap(recipe => recipe.photos.map(photo => photo.s3Key));
        // Delete S3 objects
        try {
            if (allS3Keys.length > 0) {
                const s3 = new client_s3_1.S3Client({ region });
                await s3.send(new client_s3_1.DeleteObjectsCommand({
                    Bucket: bucket,
                    Delete: {
                        Objects: allS3Keys.map(key => ({ Key: key })),
                        Quiet: true,
                    },
                }));
            }
        }
        catch (error) {
            console.error("S3 delete error:", error);
            // Continue with DB cleanup even if S3 delete fails
        }
        // Delete all related data in transactions
        const recipeIdsToDelete = recipes.map(r => r.id);
        await db_1.prisma.$transaction([
            // Delete all related data first
            db_1.prisma.photo.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.ingredient.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.comment.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.like.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.recipeTag.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.collectionRecipe.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            db_1.prisma.nutrition.deleteMany({ where: { recipeId: { in: recipeIdsToDelete } } }),
            // Finally delete the recipes
            db_1.prisma.recipe.deleteMany({ where: { id: { in: recipeIdsToDelete } } }),
        ]);
        return server_1.NextResponse.json({
            success: true,
            deletedCount: recipes.length
        });
    }
    catch (error) {
        console.error("Bulk delete error:", error);
        return server_1.NextResponse.json({ error: "Failed to delete recipes" }, { status: 500 });
    }
}
