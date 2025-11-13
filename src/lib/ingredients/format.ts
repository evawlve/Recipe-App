import { parseIngredientLine } from "@/lib/parse/ingredient-line";

type IngredientLike = {
  qty: number;
  unit: string;
  name: string;
};

const FRACTION_DENOMINATORS = [2, 3, 4, 5, 6, 8, 10, 12, 16];

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

export function formatIngredientQuantity(qty: number | null | undefined): string {
  if (qty === null || qty === undefined || !Number.isFinite(qty) || qty <= 0) {
    return "";
  }

  const whole = Math.floor(qty);
  const remainder = qty - whole;
  const tolerance = 1e-3;

  let fraction = "";

  for (const denom of FRACTION_DENOMINATORS) {
    const numerator = Math.round(remainder * denom);
    if (numerator === 0) continue;

    const approx = numerator / denom;
    if (Math.abs(approx - remainder) <= tolerance) {
      const divisor = gcd(numerator, denom);
      const simpleNum = numerator / divisor;
      const simpleDen = denom / divisor;
      fraction = `${simpleNum}/${simpleDen}`;
      break;
    }
  }

  const wholePart = whole > 0 ? whole.toString() : "";

  if (fraction && wholePart) {
    return `${wholePart} ${fraction}`;
  }

  if (fraction) {
    return fraction;
  }

  if (wholePart) {
    return wholePart;
  }

  // Fallback to decimal with max 2 decimals, trim trailing zeros
  return qty.toFixed(2).replace(/\.?0+$/, "");
}

export function formatIngredientLineForDisplay(ingredient: IngredientLike): string {
  const parts = [
    formatIngredientQuantity(ingredient.qty),
    ingredient.unit?.trim(),
    ingredient.name?.trim(),
  ].filter(Boolean);

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

type ParsedIngredient = {
  qty: number;
  unit: string;
  name: string;
};

export function parseIngredientInput(line: string): ParsedIngredient {
  const trimmed = line.trim();

  if (!trimmed) {
    return {
      qty: 1,
      unit: "",
      name: "",
    };
  }

  const parsed = parseIngredientLine(trimmed);

  if (!parsed) {
    return {
      qty: 1,
      unit: "",
      name: trimmed,
    };
  }

  const effectiveQty = Math.max(parsed.qty * (parsed.multiplier ?? 1), 0.01);
  const unit = parsed.rawUnit ?? parsed.unit ?? "";

  const qualifiers = parsed.qualifiers?.length ? `, ${parsed.qualifiers.join(", ")}` : "";
  const unitHint = parsed.unitHint && !trimmed.toLowerCase().includes(parsed.unitHint.toLowerCase())
    ? ` ${parsed.unitHint}`
    : "";

  const nameBase = parsed.name?.trim() || "";
  const combinedName = `${nameBase}${unitHint}${qualifiers}`.trim();

  return {
    qty: effectiveQty,
    unit,
    name: combinedName || trimmed,
  };
}

