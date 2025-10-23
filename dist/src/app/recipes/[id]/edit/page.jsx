"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = EditRecipePage;
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const navigation_1 = require("next/navigation");
const EditRecipeForm_1 = __importDefault(require("./EditRecipeForm"));
async function EditRecipePage({ params }) {
    const resolvedParams = await params;
    const currentUser = await (0, auth_1.getCurrentUser)();
    if (!currentUser) {
        (0, navigation_1.redirect)("/signin");
    }
    // Load recipe with all related data
    const recipe = await db_1.prisma.recipe.findUnique({
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
                },
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
        (0, navigation_1.notFound)();
    }
    // Check if current user is the author
    if (currentUser.id !== recipe.authorId) {
        (0, navigation_1.redirect)(`/recipes/${recipe.id}`);
    }
    // Transform data for the form
    const formData = {
        title: recipe.title,
        servings: recipe.servings,
        bodyMd: recipe.bodyMd,
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
        })),
    };
    return (<EditRecipeForm_1.default recipeId={recipe.id} initialData={formData}/>);
}
