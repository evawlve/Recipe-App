export function mapUsdaToCategory(usdaDesc: string, usdaCategory?: string|null): string|null {
  const s = `${usdaDesc} ${usdaCategory||''}`.toLowerCase();

  if (/\boil|olive|canola|avocado|coconut\b/.test(s)) return 'oil';
  if (/\bflour|starch|cornstarch|almond flour|oat flour\b/.test(s)) return 'flour';
  if (/\bwhey|protein powder\b/.test(s)) return 'whey';
  if (/\boats?\b/.test(s)) return 'oats';
  if (/\brice\b/.test(s)) return 'rice_uncooked';
  if (/\bquinoa\b/.test(s)) return 'rice_uncooked';
  if (/\bbean|chickpea|lentil|legume\b/.test(s)) return 'legume';
  if (/\bchicken|beef|pork|turkey|lamb|duck|goose|egg\b/.test(s)) return 'meat';
  if (/\bfish|salmon|tuna|cod|tilapia|trout|halibut|bass|snapper\b/.test(s)) return 'meat';
  if (/\bshrimp|crab|lobster|clam|mussel|oyster|scallop|shellfish|crustacean\b/.test(s)) return 'meat';
  if (/\bmilk|yogurt|cheese\b/.test(s)) return 'dairy';
  if (/\bspinach|broccoli|vegetable|veg|carrot|tomato|potato|onion|pepper|lettuce|kale|cucumber|cauliflower|eggplant|zucchini|squash\b/.test(s)) return 'veg';
  if (/\bapple|banana|fruit|berries?|blueberry|strawberry|raspberry|blackberry|cranberry\b/.test(s)) return 'fruit';
  if (/\bnut|almond|peanut|walnut|cashew|pecan|pistachio|hazelnut|macadamia\b/.test(s)) return 'legume';
  if (/\bgarlic|ginger|basil|oregano|cilantro|parsley|thyme|rosemary|mint|cinnamon|cumin|turmeric|paprika|herb|spice\b/.test(s)) return 'veg';
  if (/\bsugar|sweetener|honey|syrup|molasses\b/.test(s)) return 'sugar';
  // Removed 'sauce' category - too many prepared/branded items. Users can add manually if needed.
  // if (/\bsauce|ketchup|mustard|sriracha|mayo\b/.test(s)) return 'sauce';
  if (/\bcheddar|mozzarella|cheese\b/.test(s)) return 'cheese';
  return null;
}
