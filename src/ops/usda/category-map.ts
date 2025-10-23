export function mapUsdaToCategory(usdaDesc: string, usdaCategory?: string|null): string|null {
  const s = `${usdaDesc} ${usdaCategory||''}`.toLowerCase();

  if (/\boil|olive|canola|avocado|coconut\b/.test(s)) return 'oil';
  if (/\bflour|starch|cornstarch|almond flour|oat flour\b/.test(s)) return 'flour';
  if (/\bwhey|protein powder\b/.test(s)) return 'whey';
  if (/\boats?\b/.test(s)) return 'oats';
  if (/\brice\b/.test(s)) return 'rice_uncooked';
  if (/\bbean|chickpea|lentil|legume\b/.test(s)) return 'legume';
  if (/\bchicken|beef|pork|turkey|salmon|tuna|egg\b/.test(s)) return 'meat';
  if (/\bmilk|yogurt|cheese\b/.test(s)) return 'dairy';
  if (/\bspinach|broccoli|vegetable|veg\b/.test(s)) return 'veg';
  if (/\bapple|banana|fruit|berries?\b/.test(s)) return 'fruit';
  if (/\bsugar|sweetener\b/.test(s)) return 'sugar';
  if (/\bsauce|ketchup|mustard|sriracha|mayo\b/.test(s)) return 'sauce';
  if (/\bcheddar|mozzarella|cheese\b/.test(s)) return 'cheese';
  return null;
}
