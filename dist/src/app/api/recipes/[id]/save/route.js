"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
const collections_1 = require("@/lib/collections");
const db_1 = require("@/lib/db");
async function POST(request, { params }) {
    try {
        const resolvedParams = await params;
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const recipeId = resolvedParams.id;
        // Ensure the recipe exists and get author info
        const recipe = await db_1.prisma.recipe.findUnique({
            where: { id: recipeId },
            select: { id: true, authorId: true, title: true }
        });
        if (!recipe) {
            return server_1.NextResponse.json({ error: "Recipe not found" }, { status: 404 });
        }
        // Get or create the user's Saved collection
        const collectionId = await (0, collections_1.ensureSavedCollection)(user.id);
        // Upsert the CollectionRecipe relationship
        await db_1.prisma.collectionRecipe.upsert({
            where: {
                collectionId_recipeId: {
                    collectionId,
                    recipeId
                }
            },
            update: {},
            create: {
                collectionId,
                recipeId
            }
        });
        // Create notification for recipe author if they're not the one saving
        if (recipe.authorId !== user.id) {
            await db_1.prisma.notification.create({
                data: {
                    userId: recipe.authorId,
                    actorId: user.id,
                    type: 'save',
                    recipeId: recipe.id
                }
            });
        }
        // Get the count of saved recipes for this user
        const count = await db_1.prisma.collectionRecipe.count({
            where: { collectionId }
        });
        return server_1.NextResponse.json({ saved: true, count });
    }
    catch (error) {
        console.error("Error saving recipe:", error);
        return server_1.NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
async function DELETE(request, { params }) {
    try {
        const resolvedParams = await params;
        const user = await (0, auth_1.getCurrentUser)();
        if (!user) {
            return server_1.NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        const recipeId = resolvedParams.id;
        // Get the user's Saved collection
        const savedCollection = await db_1.prisma.collection.findUnique({
            where: {
                userId_name: {
                    userId: user.id,
                    name: "Saved"
                }
            }
        });
        if (!savedCollection) {
            // No saved collection exists, so nothing to delete
            return server_1.NextResponse.json({ saved: false, count: 0 });
        }
        // Delete the CollectionRecipe relationship (ignore if missing)
        await db_1.prisma.collectionRecipe.deleteMany({
            where: {
                collectionId: savedCollection.id,
                recipeId
            }
        });
        // Get the count of saved recipes for this user
        const count = await db_1.prisma.collectionRecipe.count({
            where: { collectionId: savedCollection.id }
        });
        return server_1.NextResponse.json({ saved: false, count });
    }
    catch (error) {
        console.error("Error unsaving recipe:", error);
        return server_1.NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
