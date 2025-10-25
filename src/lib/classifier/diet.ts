import type { Nutrition } from '@prisma/client';

interface DietSuggestion {
  slug: string;
  namespace: 'DIET';
  confidence: number;
}

// Meat/fish keywords for vegetarian detection
const MEAT_KEYWORDS = [
  'beef', 'pork', 'chicken', 'turkey', 'duck', 'lamb', 'goat', 'venison',
  'fish', 'salmon', 'tuna', 'cod', 'halibut', 'mackerel', 'sardines',
  'shrimp', 'crab', 'lobster', 'scallops', 'mussels', 'oysters',
  'bacon', 'sausage', 'ham', 'pepperoni', 'salami', 'prosciutto',
  'ground beef', 'ground turkey', 'ground chicken', 'ground pork'
];

// Dairy keywords for vegan detection
const DAIRY_KEYWORDS = [
  'milk', 'cheese', 'butter', 'cream', 'yogurt', 'sour cream',
  'mozzarella', 'cheddar', 'parmesan', 'ricotta', 'feta', 'brie',
  'heavy cream', 'half and half', 'buttermilk', 'kefir',
  'whey', 'casein', 'lactose'
];

// Egg keywords for vegan detection
const EGG_KEYWORDS = [
  'egg', 'eggs', 'egg white', 'egg yolk', 'mayonnaise', 'mayo'
];

// Honey keywords for vegan detection
const HONEY_KEYWORDS = [
  'honey', 'bee pollen', 'royal jelly', 'propolis'
];

// Gluten keywords for gluten-free detection
const GLUTEN_KEYWORDS = [
  'wheat', 'barley', 'rye', 'oats', 'flour', 'bread', 'pasta',
  'noodles', 'couscous', 'bulgur', 'semolina', 'spelt', 'kamut',
  'soy sauce', 'teriyaki', 'malt', 'brewer\'s yeast'
];

// Nut keywords for nut-free detection
const NUT_KEYWORDS = [
  'almond', 'almonds', 'walnut', 'walnuts', 'pecan', 'pecans',
  'cashew', 'cashews', 'pistachio', 'pistachios', 'hazelnut', 'hazelnuts',
  'macadamia', 'brazil nut', 'pine nut', 'peanut', 'peanuts',
  'almond butter', 'peanut butter', 'cashew butter', 'nut butter'
];

export function dietSuggestions(nutrition: Nutrition | null, ingredientsText: string): DietSuggestion[] {
  const suggestions: DietSuggestion[] = [];
  const text = ingredientsText.toLowerCase();

  // Vegetarian check (no meat/fish)
  const hasMeat = MEAT_KEYWORDS.some(keyword => text.includes(keyword));
  if (!hasMeat) {
    suggestions.push({
      slug: 'vegetarian',
      namespace: 'DIET',
      confidence: 0.8
    });
  }

  // Vegan check (vegetarian + no dairy/eggs/honey)
  const hasDairy = DAIRY_KEYWORDS.some(keyword => text.includes(keyword));
  const hasEggs = EGG_KEYWORDS.some(keyword => text.includes(keyword));
  const hasHoney = HONEY_KEYWORDS.some(keyword => text.includes(keyword));
  
  if (!hasMeat && !hasDairy && !hasEggs && !hasHoney) {
    suggestions.push({
      slug: 'vegan',
      namespace: 'DIET',
      confidence: 0.7
    });
  }

  // Gluten-free check
  const hasGluten = GLUTEN_KEYWORDS.some(keyword => text.includes(keyword));
  if (!hasGluten) {
    suggestions.push({
      slug: 'gluten_free',
      namespace: 'DIET',
      confidence: 0.7
    });
  }

  // Dairy-free check
  if (!hasDairy) {
    suggestions.push({
      slug: 'dairy_free',
      namespace: 'DIET',
      confidence: 0.7
    });
  }

  // Nut-free check
  const hasNuts = NUT_KEYWORDS.some(keyword => text.includes(keyword));
  if (!hasNuts) {
    suggestions.push({
      slug: 'nut_free',
      namespace: 'DIET',
      confidence: 0.7
    });
  }

  // High protein check
  if (nutrition) {
    const proteinG = nutrition.proteinG || 0;
    const calories = nutrition.calories || 0;
    
    // High protein if >= 20g protein OR >= 10g protein per 200kcal
    const proteinPer200kcal = calories > 0 ? (proteinG * 200) / calories : 0;
    
    if (proteinG >= 20 || proteinPer200kcal >= 10) {
      suggestions.push({
        slug: 'high_protein',
        namespace: 'DIET',
        confidence: 0.85
      });
    }
  }

  return suggestions;
}
