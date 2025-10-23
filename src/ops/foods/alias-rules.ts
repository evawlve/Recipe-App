// Generic alias generation for Foods by name + category
export function canonicalAlias(s: string) {
  return s.toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FAT_MOD_GROUPS: string[][] = [
  ['nonfat','fat free','fat-free','skim'],
  ['part skim','part-skim'],
  ['reduced fat','low fat','lite','light','2%','1%'],
];

function permutations(heads: string[], mods: string[]) {
  const out = new Set<string>();
  for (const h of heads) for (const m of mods) {
    out.add(`${m} ${h}`);    // "nonfat cheddar"
    out.add(`${h} ${m}`);    // "cheddar nonfat"
  }
  return Array.from(out);
}

function expandFatMods(base: string) {
  const out = new Set<string>();
  for (const group of FAT_MOD_GROUPS) {
    for (const term of group) {
      out.add(`${base} ${term}`);
      out.add(`${term} ${base}`);
    }
  }
  return Array.from(out);
}

export function generateAliasesForFood(name: string, categoryId: string | null): string[] {
  const s = name.toLowerCase();
  const out = new Set<string>();

  // always include a canonicalized name
  out.add(canonicalAlias(name));

  // ----- CHEESE -----
  const isCheese = categoryId === 'cheese' || /\bcheese|mozzarella|cheddar|parmesan|jack|swiss|colby|gouda|feta|ricotta\b/.test(s);
  if (isCheese) {
    const heads = ['cheese'];
    if (s.includes('mozzarella')) heads.push('mozzarella');
    if (s.includes('cheddar')) heads.push('cheddar');
    out.add('cheese'); // generic
    
    // Only generate fat modifier aliases for products that actually have those modifiers in their name
    const hasNonfat = /\bnonfat|fat.?free|skim\b/.test(s);
    const hasPartSkim = /\bpart.?skim\b/.test(s);
    const hasReducedFat = /\breduced.?fat|low.?fat|light|lite\b/.test(s);
    
    if (hasNonfat) {
      for (const head of heads) {
        out.add(`nonfat ${head}`);
        out.add(`${head} nonfat`);
        out.add(`fat free ${head}`);
        out.add(`${head} fat free`);
        out.add(`skim ${head}`);
        out.add(`${head} skim`);
      }
    }
    
    if (hasPartSkim) {
      for (const head of heads) {
        out.add(`part skim ${head}`);
        out.add(`${head} part skim`);
      }
    }
    
    if (hasReducedFat) {
      for (const head of heads) {
        out.add(`reduced fat ${head}`);
        out.add(`${head} reduced fat`);
        out.add(`low fat ${head}`);
        out.add(`${head} low fat`);
        out.add(`light ${head}`);
        out.add(`${head} light`);
      }
    }
    
    // short forms
    if (s.includes('mozzarella')) { out.add('mozz'); out.add('mozzarella cheese'); }
    if (s.includes('cheddar')) out.add('cheddar cheese');
  }

  // ----- MILK ----
  const isMilk = categoryId === 'dairy' || /\bmilk\b/.test(s);
  if (isMilk) {
    // Only generate generic milk aliases for generic milk products
    // Don't generate "nonfat milk" for "goat milk" or "almond milk"
    const isGenericMilk = /\b(milk|dairy)\b/.test(s) && !/\b(goat|sheep|almond|soy|oat|coconut|rice)\b/.test(s);
    if (isGenericMilk) {
      const heads = ['milk'];
      for (const group of FAT_MOD_GROUPS) {
        for (const alias of permutations(heads, group)) out.add(alias);
      }
    }
  }

  // ----- DAIRY (yogurt) -----
  const isDairy = categoryId === 'dairy' || /\byogurt|yoghurt|cream cheese|cottage cheese\b/.test(s);
  if (isDairy) {
    if (s.includes('yogurt') || s.includes('yoghurt')) {
      out.add('yoghurt'); out.add('greek yogurt'); out.add('greek yoghurt');
      for (const alias of expandFatMods('yogurt')) out.add(alias);
    }
  }

  // ----- WHEY / PROTEIN POWDER -----
  if (categoryId === 'whey' || /\bwhey|protein powder\b/.test(s)) {
    out.add('whey'); out.add('whey protein'); out.add('protein powder'); out.add('whey powder'); out.add('whey protein powder');
    if (s.includes('isolate')) { out.add('whey isolate'); out.add('protein isolate'); out.add('whey protein isolate'); }
    if (s.includes('concentrate')) { out.add('whey concentrate'); out.add('protein concentrate'); out.add('whey protein concentrate'); }
  }

  // ----- FLOUR / STARCH (powder synonyms) -----
  if (categoryId === 'flour' || /\bflour|starch\b/.test(s)) {
    out.add(s.replace(/flour/g, 'powder').trim());
    out.add('powder');
    // common flours
    if (s.includes('oat')) out.add('oat flour'); // reinforce
    if (s.includes('almond')) out.add('almond flour');
    if (s.includes('corn starch') || s.includes('cornstarch')) { out.add('cornstarch'); out.add('corn starch'); }
  }

  // ----- OIL -----
  if (categoryId === 'oil' || /\boil\b/.test(s)) {
    out.add(s.replace(/\s*oil\b/, '').trim()); // "olive oil" -> "olive"
    out.add('cooking oil');
  }

  // ----- EGGS -----
  if (/\begg\b/.test(s)) {
    out.add('egg'); out.add('eggs');
    if (s.includes('white')) { out.add('egg white'); out.add('egg whites'); out.add('carton egg whites'); }
  }

  // ----- RICE / OATS -----
  if (categoryId === 'rice_uncooked' || /\brice\b/.test(s)) {
    out.add('white rice'); out.add('brown rice'); // catch typical queries
  }
  if (categoryId === 'oats' || /\boats\b/.test(s)) {
    out.add('rolled oats'); out.add('old fashioned oats'); out.add('oatmeal');
  }

  return Array.from(out).filter(Boolean);
}
