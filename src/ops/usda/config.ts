export type UsdaSaturationFilters = {
  // FDC fields to include
  includeDataTypes: Array<'SR Legacy'|'Survey (FNDDS)'|'Branded'|'SR Legacy Foundation'|'Foundation'>;
  // Substring rules applied to description/foodCategory fields
  excludeIfNameHas: string[];
  excludeIfCategoryHas: string[];
  // Name pattern exclusions (regex patterns)
  excludeNamePatterns: RegExp[];
  // Hard calorie plausibility (kcal/100 g)
  kcalMin: number;
  kcalMax: number;
  // Macro sanity check threshold (% deviation allowed)
  macroSanityThreshold: number;
  // Require at least one macro present
  requireMacros: boolean;
};

export const DEFAULT_SATURATION_FILTERS: UsdaSaturationFilters = {
  includeDataTypes: ['Foundation', 'SR Legacy'],
  excludeIfNameHas: [
    // Restaurant and fast food chains
    "mcdonald's",'mcdonald','burger king','wendy','wendys',"wendy's",'kfc','popeye','popeyes',
    'subway','taco bell','chick-fil-a','chick fil a','applebee','applebees',"applebee's",
    'olive garden','carrabba','cracker barrel','t.g.i','tgi friday','denny','dennys',"denny's",
    'pizza hut','domino','papa john','chipotle','panera','arby','arbys','sonic drive',
    // General exclusions
    'infant','baby','toddler','supplement','formula','shake mix','restaurant','fast food',
    'branded','brand','capsule','tablet','gummy','energy drink','sports drink',
    // Prepared meal indicators
    'kids menu','kid menu','kids\' menu','platter','combo','value meal',
    // Branded products
    'kraft','buitoni','classico','mezzetta','bull','masterpiece','open pit','ocean spray',
    // Desserts and prepared items
    'ice cream','frozen dessert','margarine','shortening'
  ],
  excludeIfCategoryHas: [
    'Baby','Infant','Restaurant','Supplements','Formula','Dietary supplement','Fast Foods'
  ],
  // Exclude complex prepared dishes, meals, and combinations
  // These patterns will be checked AFTER basic filtering but WITH exceptions for core staples
  excludeNamePatterns: [
    // Prepared meals and combinations
    /\b(salads?|casseroles?|entrees?|meal\s+kits?|sandwiches?|burritos?|wraps?|frozen\s+dinners?|pot\s+pies?)\b/i,
    // Restaurant-style preparations
    /\b(platters?|combos?|supreme|deluxe|meals?|kids|kits?|trays?)\b/i,
    // Filled/stuffed items (typically not basic ingredients)
    /\b(filled|stuffed|topped\s+with|smothered)\b/i,
    // Multi-ingredient indicators
    /\b(with\s+(cheese|lettuce|tomato|sauce|gravy|vegetables?|bacon|ham|milk|butter|margarine|oil))\b/i,
    /\b(and\s+(cheese|vegetables?|rice|pasta|noodles|beans|potatoes?|butter|margarine))\b/i,
    // Specific problem foods
    /\b(nuggets?|strips?|tenders?|fingers?|popcorn\s+chicken|taquitos?|turnovers?|quesadillas?)\b/i,
    // Desserts and sweets
    /\b(custards?|puddings?|pies?|cakes?|cookies?|brownies?|tarts?|pastries?)\b/i,
    // Asian prepared foods
    /\b(egg\s+rolls?|spring\s+rolls?|wontons?|dumplings?|dim\s+sum)\b/i,
    // Bread products (not breadcrumbs which are ingredients)
    /\bbread\b(?!\s*(crumb|ing))/i,
    // Frozen prepared items
    /\b(frozen.*breaded|breaded.*frozen)\b/i,
    // Prepared/processed potato products
    /\b(mashed|hash\s*browns?|french\s*frie[ds]?|fries|chips|crisps|scalloped|candied|puffs?|pancakes?)\b/i,
    // Preparation indicators
    /\b(home-prepared|ready-to-eat|refrigerated.*prepared)\b/i,
    // Processed snacks
    /\b(snacks?|granules?|flakes?)\b/i,
    // Prepared sauces (exclude most sauces except very basic ones handled separately)
    /\b(alfredo|pesto|barbecue|bbq|teriyaki|tartar|steak\s+sauce|cheese\s+sauce|cranberry\s+sauce|applesauce)\b/i,
    // Complete meals that mention sauce
    /\b(spaghetti|pasta|lasagna|ravioli).*\bsauce\b/i,
  ],
  kcalMin: 5,
  kcalMax: 900,
  macroSanityThreshold: 0.30, // 30% deviation allowed
  requireMacros: true,
};
