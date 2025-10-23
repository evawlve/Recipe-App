"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = MePage;
const navigation_1 = require("next/navigation");
const auth_1 = require("@/lib/auth");
const collections_1 = require("@/lib/collections");
const db_1 = require("@/lib/db");
const MePageClient_1 = require("./MePageClient");
async function MePage({ searchParams }) {
    const user = await (0, auth_1.getCurrentUser)();
    if (!user) {
        (0, navigation_1.redirect)("/signin");
    }
    // Fetch the complete user data with new fields
    const fullUser = await db_1.prisma.user.findUnique({
        where: { id: user.id },
        select: {
            id: true,
            name: true,
            email: true,
            firstName: true,
            lastName: true,
            username: true,
            bio: true,
            avatarUrl: true,
            avatarKey: true,
        }
    });
    if (!fullUser) {
        (0, navigation_1.redirect)("/signin");
    }
    const { tab = "saved" } = await searchParams;
    // Ensure we have a "Saved" collection for this user
    const savedCollectionId = await (0, collections_1.ensureSavedCollection)(user.id);
    // Fetch data in parallel
    const [uploaded, saved, uploadedCount, savedCount, followersCount, followingCount] = await Promise.all([
        db_1.prisma.recipe.findMany({
            where: { authorId: user.id },
            orderBy: { createdAt: "desc" },
            take: 24,
            select: {
                id: true,
                title: true,
                createdAt: true,
                author: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        displayName: true,
                        avatarKey: true
                    }
                },
                photos: { select: { id: true, s3Key: true, width: true, height: true }, take: 1 }
            }
        }),
        db_1.prisma.recipe.findMany({
            where: { collections: { some: { collectionId: savedCollectionId } } },
            orderBy: { createdAt: "desc" },
            take: 24,
            select: {
                id: true,
                title: true,
                createdAt: true,
                author: {
                    select: {
                        id: true,
                        name: true,
                        username: true,
                        displayName: true,
                        avatarKey: true
                    }
                },
                photos: { select: { id: true, s3Key: true, width: true, height: true }, take: 1 }
            }
        }),
        db_1.prisma.recipe.count({ where: { authorId: user.id } }),
        db_1.prisma.collectionRecipe.count({ where: { collectionId: savedCollectionId } }),
        db_1.prisma.follow.count({ where: { followingId: user.id } }),
        db_1.prisma.follow.count({ where: { followerId: user.id } }),
    ]);
    return (<MePageClient_1.MePageClient user={fullUser} uploaded={uploaded} saved={saved} uploadedCount={uploadedCount} savedCount={savedCount} followersCount={followersCount} followingCount={followingCount} tab={tab}/>);
}
