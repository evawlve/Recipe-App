import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { goalSuggestions, methodSuggestions, cuisineSuggestions, computeMacroFeatures } from "@/lib/classifier/heuristics";
import { dietSuggestions } from "@/lib/classifier/diet";

interface Suggestion {
  id: string;
  title: string;
  description: string;
  confidence: number;
  namespace: string;
  slug: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await params;
    const recipeId = resolvedParams.id;

    // Get recipe with nutrition and ingredients
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId },
      include: { 
        nutrition: true,
        ingredients: true,
        tags: {
          include: {
            tag: true
          }
        }
      }
    });

    if (!recipe) {
      return NextResponse.json({ error: "Recipe not found" }, { status: 404 });
    }

    // Get existing tags to avoid duplicates
    const existingTags = recipe.tags.map(rt => rt.tag.slug);
    
    // Prepare text for analysis
    const ingredientsText = recipe.ingredients.map(i => i.name ?? '').join(' ');
    const textBlob = `${recipe.title}\n${recipe.bodyMd}\n${ingredientsText}`;

    // Generate suggestions
    const suggestions: Suggestion[] = [];

    // Diet suggestions
    const dietSuggestionsList = dietSuggestions(recipe.nutrition, ingredientsText);
    for (const suggestion of dietSuggestionsList) {
      if (!existingTags.includes(suggestion.slug)) {
        suggestions.push({
          id: `diet-${suggestion.slug}`,
          title: `Add ${suggestion.slug.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} tag`,
          description: `This recipe appears to be ${suggestion.slug.replace('_', ' ')} based on ingredients and nutrition.`,
          confidence: suggestion.confidence,
          namespace: suggestion.namespace,
          slug: suggestion.slug
        });
      }
    }

    // Method suggestions
    const methodSuggestionsList = methodSuggestions(textBlob);
    for (const suggestion of methodSuggestionsList) {
      if (!existingTags.includes(suggestion.slug)) {
        suggestions.push({
          id: `method-${suggestion.slug}`,
          title: `Add ${suggestion.slug.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} tag`,
          description: `This recipe uses ${suggestion.slug.replace('_', ' ')} cooking method.`,
          confidence: suggestion.confidence,
          namespace: 'METHOD',
          slug: suggestion.slug
        });
      }
    }

    // Cuisine suggestions
    const cuisineSuggestionsList = cuisineSuggestions(ingredientsText);
    for (const suggestion of cuisineSuggestionsList) {
      if (!existingTags.includes(suggestion.slug)) {
        suggestions.push({
          id: `cuisine-${suggestion.slug}`,
          title: `Add ${suggestion.slug.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} tag`,
          description: `This recipe has ${suggestion.slug} cuisine characteristics.`,
          confidence: suggestion.confidence,
          namespace: 'CUISINE',
          slug: suggestion.slug
        });
      }
    }

    // Goal suggestions
    const goalSuggestionsList = goalSuggestions(recipe.nutrition);
    for (const suggestion of goalSuggestionsList) {
      if (!existingTags.includes(suggestion.slug)) {
        suggestions.push({
          id: `goal-${suggestion.slug}`,
          title: `Add ${suggestion.slug.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())} tag`,
          description: `This recipe is suitable for ${suggestion.slug.replace('_', ' ')} goals.`,
          confidence: suggestion.confidence,
          namespace: 'GOAL',
          slug: suggestion.slug
        });
      }
    }

    // Sort by confidence (highest first)
    suggestions.sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      suggestions: suggestions.slice(0, 10) // Limit to top 10 suggestions
    });

  } catch (error) {
    console.error("Error fetching recipe suggestions:", error);
    return NextResponse.json(
      { error: "Failed to fetch suggestions" },
      { status: 500 }
    );
  }
}
