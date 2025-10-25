import type { Nutrition } from '@prisma/client';

interface Suggestion {
  slug: string;
  confidence: number;
}

interface MacroFeatures {
  pPct: number;  // protein percentage
  cPct: number;  // carbs percentage
  fPct: number;  // fat percentage
  fiber: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// Method keywords
const METHOD_KEYWORDS = {
  air_fry: ['air fry', 'air fryer', 'air-fry', 'air-fried'],
  bake: ['bake', 'baked', 'baking', 'oven', 'roast', 'roasted', 'roasting'],
  grill: ['grill', 'grilled', 'grilling', 'barbecue', 'bbq', 'char-grill']
};

// Cuisine keywords
const CUISINE_KEYWORDS = {
  mexican: [
    'taco', 'burrito', 'quesadilla', 'enchilada', 'salsa', 'guacamole',
    'cilantro', 'lime', 'jalapeño', 'cumin', 'chili', 'black beans',
    'pinto beans', 'corn', 'avocado', 'tortilla', 'chipotle', 'adobo'
  ],
  italian: [
    'pasta', 'spaghetti', 'penne', 'fettuccine', 'lasagna', 'risotto',
    'pizza', 'mozzarella', 'parmesan', 'basil', 'oregano', 'thyme',
    'rosemary', 'olive oil', 'garlic', 'tomato', 'marinara', 'pesto',
    'ricotta', 'prosciutto', 'pancetta', 'balsamic'
  ],
  american: [
    'burger', 'hot dog', 'fries', 'french fries', 'ketchup', 'mustard',
    'pickle', 'onion rings', 'mac and cheese', 'fried chicken',
    'barbecue', 'bbq', 'ranch', 'buffalo', 'wings'
  ]
};

export function computeMacroFeatures(nutrition: Nutrition | null): MacroFeatures {
  if (!nutrition) {
    return {
      pPct: 0, cPct: 0, fPct: 0, fiber: 0, kcal: 0,
      protein: 0, carbs: 0, fat: 0
    };
  }

  const kcal = nutrition.calories || 0;
  const protein = nutrition.proteinG || 0;
  const carbs = nutrition.carbsG || 0;
  const fat = nutrition.fatG || 0;
  const fiber = nutrition.fiberG || 0;

  // Calculate percentages of calories from each macro
  const proteinCalories = protein * 4;
  const carbCalories = carbs * 4;
  const fatCalories = fat * 9;
  const totalMacroCalories = proteinCalories + carbCalories + fatCalories;

  const pPct = totalMacroCalories > 0 ? (proteinCalories / totalMacroCalories) * 100 : 0;
  const cPct = totalMacroCalories > 0 ? (carbCalories / totalMacroCalories) * 100 : 0;
  const fPct = totalMacroCalories > 0 ? (fatCalories / totalMacroCalories) * 100 : 0;

  return {
    pPct, cPct, fPct, fiber, kcal, protein, carbs, fat
  };
}

export function goalSuggestions(nutrition: Nutrition | null): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const { pPct, cPct, fPct, fiber, kcal, protein, carbs } = computeMacroFeatures(nutrition);
  if (!nutrition || !kcal) return suggestions;

  // Candidate flags
  const preCandidate =
    cPct >= 45 &&
    fPct <= 20 &&
    (fiber ?? 0) <= 8 &&
    ((protein ?? 0) <= 35 || pPct <= 30);

  const postCandidate =
    (protein ?? 0) >= 30 &&
    cPct >= 25 &&
    fPct <= 25;

  // Base confidences
  let preConf = 0;
  let postConf = 0;

  if (preCandidate) {
    preConf = 0.70;
    if (cPct >= 55) preConf += 0.05;
    if (kcal > 750) preConf -= 0.10;
    // strong protein should not be pre
    if ((protein ?? 0) > 40) preConf -= 0.20;
  }

  if (postCandidate) {
    postConf = 0.75;
    if ((protein ?? 0) >= 40) postConf += 0.05;
    if (cPct >= 40) postConf += 0.05;
  }

  // Tie-breaker: prefer POST when protein:carb ratio is higher
  if (preCandidate && postCandidate) {
    const R = (protein ?? 0) / Math.max(1, (carbs ?? 0));
    if (R >= 0.45) {
      // choose post only
      preConf = 0;
    } else {
      // choose pre only
      postConf = 0;
    }
  }

  if (preConf >= 0.6) {
    suggestions.push({ 
      slug: 'pre_workout', 
      confidence: Math.max(0.55, Math.min(preConf, 0.9)) 
    });
  }
  if (postConf >= 0.6) {
    suggestions.push({ 
      slug: 'post_workout', 
      confidence: Math.max(0.6, Math.min(postConf, 0.9)) 
    });
  }

  // Fat loss / Lean bulk unchanged
  const proteinPer200kcal = kcal > 0 ? (protein * 200) / kcal : 0;
  if ((proteinPer200kcal >= 12 && kcal <= 500) || (fiber ?? 0) >= 6) {
    suggestions.push({ 
      slug: 'fat_loss', 
      confidence: 0.7 
    });
  }
  if (kcal >= 500 && (protein ?? 0) >= 25 && cPct >= 40) {
    suggestions.push({ 
      slug: 'lean_bulk', 
      confidence: 0.55 
    });
  }

  return suggestions;
}

export function methodSuggestions(text: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const lowerText = text.toLowerCase();

  for (const [method, keywords] of Object.entries(METHOD_KEYWORDS)) {
    const hasKeywords = keywords.some(keyword => lowerText.includes(keyword));
    if (hasKeywords) {
      let confidence = 0.6; // default
      if (method === 'air_fry') confidence = 0.9;
      else if (method === 'bake') confidence = 0.7;
      else if (method === 'grill') confidence = 0.6;

      suggestions.push({
        slug: method,
        confidence
      });
    }
  }

  return suggestions;
}

export function cuisineSuggestions(ingredientsText: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const lowerText = ingredientsText.toLowerCase();

  for (const [cuisine, keywords] of Object.entries(CUISINE_KEYWORDS)) {
    const matchingKeywords = keywords.filter(keyword => lowerText.includes(keyword));
    if (matchingKeywords.length > 0) {
      // Higher confidence with more matching keywords
      const confidence = Math.min(0.6 + (matchingKeywords.length * 0.1), 0.9);
      suggestions.push({
        slug: cuisine,
        confidence
      });
    }
  }

  return suggestions;
}
