import { ParsedIngredient } from '../parse/ingredient-line';
import { gramsFromVolume, Unit as VolumeUnit } from '../units/unit-graph';
import { resolveDensityGml } from '../units/density';

export type PortionSource =
  | 'direct_mass'
  | 'user_override'
  | 'portion_override'
  | 'food_unit'
  | 'density'
  | 'heuristic';

export interface PortionResolution {
  grams: number | null;
  source: PortionSource;
  confidence: number;
  tier: number;
  matchedUnit?: string;
  matchedLabel?: string;
  notes?: string;
}

export interface PortionResolverInput {
  food: {
    id: string;
    name: string;
    densityGml?: number | null;
    categoryId?: string | null;
    units?: Array<{ label: string; grams: number } | null> | null;
    portionOverrides?: Array<{ unit: string; grams: number; label?: string | null } | null> | null;
  };
  parsed: ParsedIngredient | null;
  userOverrides?: Array<{ unit: string; grams: number; label?: string | null } | null> | null;
}

type TokenSet = {
  tokens: Set<string>;
  unitTokens: Set<string>;
  qualifierTokens: Set<string>;
};

const MASS_FACTORS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  oz: 28.349523125,
  ounce: 28.349523125,
  ounces: 28.349523125,
  lb: 453.59237,
  pound: 453.59237,
  pounds: 453.59237,
};

const VOLUME_TO_UNIT: Record<string, { unit: VolumeUnit; factor: number }> = {
  ml: { unit: 'ml', factor: 1 },
  milliliter: { unit: 'ml', factor: 1 },
  milliliters: { unit: 'ml', factor: 1 },
  millilitre: { unit: 'ml', factor: 1 },
  millilitres: { unit: 'ml', factor: 1 },
  l: { unit: 'ml', factor: 1000 },
  liter: { unit: 'ml', factor: 1000 },
  liters: { unit: 'ml', factor: 1000 },
  litre: { unit: 'ml', factor: 1000 },
  litres: { unit: 'ml', factor: 1000 },
  tsp: { unit: 'tsp', factor: 1 },
  teaspoon: { unit: 'tsp', factor: 1 },
  teaspoons: { unit: 'tsp', factor: 1 },
  tbsp: { unit: 'tbsp', factor: 1 },
  tablespoon: { unit: 'tbsp', factor: 1 },
  tablespoons: { unit: 'tbsp', factor: 1 },
  cup: { unit: 'cup', factor: 1 },
  cups: { unit: 'cup', factor: 1 },
  floz: { unit: 'floz', factor: 1 },
  'fl oz': { unit: 'floz', factor: 1 },
  'fluid ounce': { unit: 'floz', factor: 1 },
  'fluid ounces': { unit: 'floz', factor: 1 },
};

type HeuristicRule = {
  keywords: string[];
  labelKeywords?: string[];
  gramsPerUnit: number;
  confidence: number;
  notes: string;
};

const HEURISTIC_RULES: HeuristicRule[] = [
  {
    keywords: ['clove', 'garlic'],
    labelKeywords: ['large'],
    gramsPerUnit: 4,
    confidence: 0.55,
    notes: 'large garlic clove heuristic',
  },
  {
    keywords: ['clove', 'garlic'],
    labelKeywords: ['small'],
    gramsPerUnit: 2,
    confidence: 0.55,
    notes: 'small garlic clove heuristic',
  },
  {
    keywords: ['clove', 'garlic'],
    gramsPerUnit: 3,
    confidence: 0.55,
    notes: 'garlic clove heuristic',
  },
  {
    keywords: ['stalk', 'celery'],
    gramsPerUnit: 40,
    confidence: 0.5,
    notes: 'celery stalk heuristic',
  },
  {
    keywords: ['leaf', 'basil'],
    gramsPerUnit: 0.6,
    confidence: 0.45,
    notes: 'fresh basil leaf heuristic',
  },
  {
    keywords: ['leaf', 'spinach'],
    gramsPerUnit: 3,
    confidence: 0.45,
    notes: 'spinach leaf heuristic',
  },
  {
    keywords: ['piece', 'ginger'],
    labelKeywords: ['inch'],
    gramsPerUnit: 11,
    confidence: 0.55,
    notes: 'ginger 1-inch piece heuristic',
  },
  {
    keywords: ['slice', 'tomato'],
    gramsPerUnit: 15,
    confidence: 0.5,
    notes: 'tomato slice heuristic',
  },
  {
    keywords: ['piece', 'avocado'],
    labelKeywords: ['half'],
    gramsPerUnit: 68,
    confidence: 0.65,
    notes: 'half avocado heuristic',
  },
];

const IRREGULAR_SINGULARS: Record<string, string> = {
  cloves: 'clove',
  leaves: 'leaf',
  whites: 'white',
  yolks: 'yolk',
  pieces: 'piece',
  slices: 'slice',
  stalks: 'stalk',
  ounces: 'ounce',
};

function singularize(token: string): string {
  if (IRREGULAR_SINGULARS[token]) return IRREGULAR_SINGULARS[token];
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('es') && token.length > 3) return token.slice(0, -2);
  if (token.endsWith('s') && token.length > 2) return token.slice(0, -1);
  return token;
}

function normalizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function explodeTokens(value: string | null | undefined, target: Set<string>) {
  const normalized = normalizeToken(value);
  if (!normalized) return;
  const cleaned = normalized.replace(/[^\w\s]/g, ' ');
  for (const token of cleaned.split(/\s+/)) {
    if (!token) continue;
    target.add(token);
    target.add(singularize(token));
  }
}

function buildTokenSets(parsed: ParsedIngredient | null): TokenSet {
  const tokens = new Set<string>();
  const unitTokens = new Set<string>();
  const qualifierTokens = new Set<string>();

  if (!parsed) {
    return { tokens, unitTokens, qualifierTokens };
  }

  explodeTokens(parsed.unit ?? undefined, unitTokens);
  explodeTokens(parsed.rawUnit ?? undefined, unitTokens);
  explodeTokens(parsed.unitHint ?? undefined, unitTokens);

  for (const qualifier of parsed.qualifiers ?? []) {
    explodeTokens(qualifier, qualifierTokens);
  }

  explodeTokens(parsed.notes ?? undefined, qualifierTokens);

  explodeTokens(parsed.name, tokens);
  for (const qualifier of qualifierTokens) tokens.add(qualifier);
  for (const unit of unitTokens) tokens.add(unit);

  return { tokens, unitTokens, qualifierTokens };
}

const DEFAULT_COUNT_UNITS = new Set(['whole', 'piece', 'each', 'count', 'unit']);

function matchesUnit(unitNorm: string, ctx: TokenSet): boolean {
  if (ctx.unitTokens.has(unitNorm) || ctx.tokens.has(unitNorm)) {
    return true;
  }

  if (DEFAULT_COUNT_UNITS.has(unitNorm)) {
    return ctx.unitTokens.size === 0;
  }

  return false;
}

function matchOverride(
  overrides: PortionResolverInput['userOverrides'],
  parsed: ParsedIngredient | null,
  ctx: TokenSet
) {
  if (!overrides || overrides.length === 0 || !parsed) return null;
  const qty = Math.max((parsed.qty ?? 0) * (parsed.multiplier ?? 1), 0);
  if (qty <= 0) return null;

  for (const override of overrides) {
    if (!override) continue;
    const unitNorm = normalizeToken(override.unit);
    if (!unitNorm) continue;

    const labelNorm = normalizeToken(override.label ?? undefined);
    const unitMatches = matchesUnit(unitNorm, ctx);
    const labelMatches =
      !labelNorm ||
      ctx.qualifierTokens.has(labelNorm) ||
      ctx.tokens.has(labelNorm);

    if (unitMatches && labelMatches) {
      return {
        grams: override.grams * qty,
        unit: unitNorm,
        label: labelNorm ?? undefined,
      };
    }
  }

  return null;
}

function resolveMass(parsed: ParsedIngredient | null): PortionResolution | null {
  if (!parsed) return null;
  const unitNorm = normalizeToken(parsed.unit ?? parsed.rawUnit ?? undefined);
  if (!unitNorm) return null;
  const factor = MASS_FACTORS[unitNorm];
  if (!factor) return null;

  const qtyEff = (parsed.qty ?? 0) * (parsed.multiplier ?? 1);
  if (qtyEff <= 0) return null;

  return {
    grams: qtyEff * factor,
    source: 'direct_mass',
    confidence: 1,
    tier: 0,
    matchedUnit: unitNorm,
  };
}

function resolvePortionOverrides(
  overrides: PortionResolverInput['food']['portionOverrides'],
  parsed: ParsedIngredient | null,
  ctx: TokenSet
): PortionResolution | null {
  if (!overrides || overrides.length === 0 || !parsed) return null;
  const qtyEff = Math.max((parsed.qty ?? 0) * (parsed.multiplier ?? 1), 0);
  if (qtyEff <= 0) return null;

  for (const override of overrides) {
    if (!override) continue;
    const unitNorm = normalizeToken(override.unit);
    if (!unitNorm) continue;
    const labelNorm = normalizeToken(override.label ?? undefined);

    const unitMatches = matchesUnit(unitNorm, ctx);
    const labelMatches =
      !labelNorm ||
      ctx.qualifierTokens.has(labelNorm) ||
      ctx.tokens.has(labelNorm);

    if (!unitMatches || !labelMatches) continue;

    return {
      grams: override.grams * qtyEff,
      source: 'portion_override',
      confidence: 0.9,
      tier: 2,
      matchedUnit: unitNorm,
      matchedLabel: labelNorm ?? undefined,
    };
  }

  return null;
}

function scoreFoodUnitLabel(
  label: string,
  ctx: TokenSet,
  parsed: ParsedIngredient | null
) {
  const unitNorm = normalizeToken(parsed?.unit ?? parsed?.rawUnit ?? undefined);
  const labelLower = label.toLowerCase();
  let score = 0;

  if (unitNorm && labelLower.includes(unitNorm)) score += 4;

  for (const token of ctx.unitTokens) {
    if (token !== unitNorm && token.length > 1 && labelLower.includes(token)) {
      score += 2;
    }
  }

  for (const qualifier of ctx.qualifierTokens) {
    if (qualifier.length > 1 && labelLower.includes(qualifier)) {
      score += 1;
    }
  }

  return score;
}

function resolveFoodUnits(
  units: PortionResolverInput['food']['units'],
  parsed: ParsedIngredient | null,
  ctx: TokenSet
): PortionResolution | null {
  if (!units || units.length === 0 || !parsed) return null;

  const qtyEff = Math.max((parsed.qty ?? 0) * (parsed.multiplier ?? 1), 0);
  if (qtyEff <= 0) return null;

  let best: { unit: { label: string; grams: number }; score: number } | null =
    null;

  for (const unit of units) {
    if (!unit) continue;
    const label = unit.label ?? '';
    const score = scoreFoodUnitLabel(label, ctx, parsed);
    if (score > 0 && (!best || score > best.score)) {
      best = { unit, score };
    }
  }

  if (!best) return null;

  return {
    grams: best.unit.grams * qtyEff,
    source: 'food_unit',
    confidence: 0.85,
    tier: 3,
    matchedUnit: best.unit.label,
    notes: `score:${best.score.toFixed(1)}`,
  };
}

function resolveDensity(
  food: PortionResolverInput['food'],
  parsed: ParsedIngredient | null,
  ctx: TokenSet
): PortionResolution | null {
  if (!parsed) return null;
  const unitCandidates = [
    normalizeToken(parsed.unit ?? undefined),
    normalizeToken(parsed.rawUnit ?? undefined),
  ].filter(Boolean) as string[];

  if (parsed.unitHint) unitCandidates.push(normalizeToken(parsed.unitHint)!);

  for (const candidate of ctx.unitTokens) {
    if (!unitCandidates.includes(candidate)) unitCandidates.push(candidate);
  }

  const seen = new Set<string>();
  const uniqueCandidates = unitCandidates.filter((u) => {
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  let selected:
    | { unit: VolumeUnit; factor: number; original: string }
    | undefined;

  for (const cand of uniqueCandidates) {
    const mapping = VOLUME_TO_UNIT[cand];
    if (mapping) {
      selected = { ...mapping, original: cand };
      break;
    }
  }

  if (!selected) return null;

  const qtyEff = Math.max((parsed.qty ?? 0) * (parsed.multiplier ?? 1), 0);
  if (qtyEff <= 0) return null;

  const density = resolveDensityGml(food.densityGml ?? undefined, food.categoryId ?? null);
  if (!density || density <= 0) return null;

  try {
    const gramsPerUnit = gramsFromVolume(
      selected.factor,
      selected.unit,
      density
    );
    return {
      grams: gramsPerUnit * qtyEff,
      source: 'density',
      confidence: 0.75,
      tier: 4,
      matchedUnit: selected.original,
      notes: `density:${density.toFixed(3)}`,
    };
  } catch {
    return null;
  }
}

function resolveHeuristic(
  parsed: ParsedIngredient | null,
  ctx: TokenSet
): PortionResolution | null {
  if (!parsed) return null;
  const qtyEff = Math.max((parsed.qty ?? 0) * (parsed.multiplier ?? 1), 0);
  if (qtyEff <= 0) return null;

  for (const rule of HEURISTIC_RULES) {
    const keywordsMatch = rule.keywords.every((kw) => ctx.tokens.has(kw));
    if (!keywordsMatch) continue;

    if (
      rule.labelKeywords &&
      !rule.labelKeywords.some((kw) => ctx.tokens.has(kw))
    ) {
      continue;
    }

    return {
      grams: rule.gramsPerUnit * qtyEff,
      source: 'heuristic',
      confidence: rule.confidence,
      tier: 5,
      notes: rule.notes,
    };
  }

  return null;
}

export function resolvePortion(input: PortionResolverInput): PortionResolution {
  const { food, parsed } = input;

  const massResult = resolveMass(parsed);
  if (massResult) {
    return massResult;
  }

  const context = buildTokenSets(parsed);

  const userMatch = matchOverride(input.userOverrides, parsed, context);
  if (userMatch) {
    return {
      grams: userMatch.grams,
      source: 'user_override',
      confidence: 1,
      tier: 1,
      matchedUnit: userMatch.unit,
      matchedLabel: userMatch.label,
    };
  }

  const portionOverride = resolvePortionOverrides(
    food.portionOverrides,
    parsed,
    context
  );
  if (portionOverride) {
    return portionOverride;
  }

  const foodUnit = resolveFoodUnits(food.units, parsed, context);
  if (foodUnit) {
    return foodUnit;
  }

  const density = resolveDensity(food, parsed, context);
  if (density) {
    return density;
  }

  const heuristic = resolveHeuristic(parsed, context);
  if (heuristic) {
    return heuristic;
  }

  return {
    grams: null,
    source: 'heuristic',
    confidence: 0,
    tier: 6,
    notes: 'unresolved',
  };
}

