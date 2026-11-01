import { SPANISH_UNIT_TOKENS } from '../parse/unit';

/**
 * isSpanishLine(): a conservative, deterministic "is this a Spanish food line" detector.
 *
 * Brief: C6970-D30-SPANISH-TRANSLATE (backend punch #170 layer 2), design = MGR s412 refute r2
 * (lexicon and rule below are the refuter's FINAL LEXICON). Evidence: the s422 read (99 Spanish
 * lines in the 60-day MappingEventLog, 48 sensible; 0 Spanish noun keys in FoodMapping against
 * `egg` 2,071 uses).
 *
 * What it is for: a TRUE line (a) always reaches the `normalize` LLM call and (b) gets the
 * Spanish-only prompt clause and the `ES:` AiNormalizeCache namespace, so its normalizedForm is
 * the English food name and it shares the curated English cache universe. A FALSE POSITIVE turns
 * an English line into an extra LLM call that may translate it, so the rule is built to be FALSE
 * on English: every English word that is also a Spanish food word lives in SHARED, which never
 * counts alone.
 *
 * Reads the RAW trimmed line (the parser has already stripped the Spanish unit and quantity words
 * from `baseName`, which is what this rule needs to see).
 *
 * To add a word, edit an array below; the logic does not change. A new entry must keep the
 * census at 0 English TRUE (gate c0 of the PR that introduced this file).
 */

/** Quantity/measure/function words. SPANISH_UNIT_TOKENS (parse/unit.ts) is unioned in below. */
export const SPANISH_MARKER_WORDS: readonly string[] = [
  'un', 'una', 'unos', 'unas', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'media', 'medio', 'mitad',
  'sin', 'con', 'del', 'tazon', 'vaso', 'vasos', 'vasito', 'pieza', 'piezas', 'orden', 'plato',
  'bolsa', 'paquete', 'porcion', 'porciones',
];

/** Markers that never license a SHARED noun (`media noche sandwich`, `del taco`). */
export const WEAK_FOR_SHARED_MARKERS: readonly string[] = ['media', 'del', 'con', 'sin'];

/** English menu words: never a noun and never a marker (dropped before matching). */
export const SPANISH_EXCLUDED_WORDS: readonly string[] = [
  'queso', 'salsa', 'taco', 'tacos', 'tortilla', 'tortillas', 'burrito', 'burritos', 'chile', 'chiles',
  'jalapeno', 'jalapenos', 'guacamole', 'pico', 'gallo', 'churro', 'churros', 'horchata', 'nacho', 'nachos',
  'quesadilla', 'quesadillas', 'enchilada', 'enchiladas', 'tamal', 'tamale', 'tamales', 'carnitas', 'carne',
  'asada', 'pastor', 'chorizo', 'fajita', 'fajitas', 'tostada', 'tostadas', 'elote', 'elotes', 'ceviche',
  'flan', 'leches', 'mole', 'pozole', 'menudo', 'birria', 'barbacoa', 'agua', 'fresca', 'margarita',
  'mojito', 'sangria', 'paella', 'gazpacho', 'empanada', 'empanadas', 'arepa', 'arepas', 'pupusa', 'pupusas',
];

/** Whole English phrases removed before tokenising (they contain a STRONG noun). */
export const SPANISH_ENGLISH_MENU_PHRASES: readonly string[] = [
  'dulce de leche', 'tres leches', 'pollo tropical', 'pollo loco', 'pollo campero', 'cafe au lait', 'pico de gallo',
];

/** Spanish-only food words (never an English word). */
export const SPANISH_STRONG_NOUNS: readonly string[] = [
  'huevo', 'huevos', 'pollo', 'arroz', 'frijol', 'frijoles', 'leche', 'jugo', 'naranja', 'manzana', 'manzanas',
  'platano', 'platanos', 'aguacate', 'aguacates', 'atun', 'pescado', 'camaron', 'camarones', 'res', 'cerdo',
  'puerco', 'pavo', 'bistec', 'pechuga', 'sopa', 'caldo', 'ensalada', 'verduras', 'verdura', 'zanahoria',
  'zanahorias', 'papas', 'tomate', 'tomates', 'jitomate', 'cebolla', 'cebollas', 'ajo', 'lechuga', 'espinaca',
  'espinacas', 'pepino', 'calabaza', 'calabacita', 'calabacitas', 'maiz', 'champinones', 'champinon', 'chicharos',
  'lentejas', 'avena', 'galleta', 'galletas', 'bizcocho', 'dulces', 'caramelo', 'helado', 'nieve', 'yogur',
  'mantequilla', 'aceite', 'azucar', 'miel', 'pimienta', 'harina', 'fideos', 'fideo', 'espagueti', 'nuez',
  'nueces', 'almendra', 'almendras', 'cacahuate', 'cacahuates', 'mani', 'fresa', 'fresas', 'uva', 'uvas',
  'sandia', 'durazno', 'duraznos', 'pera', 'peras', 'toronja', 'cereza', 'cerezas', 'mora', 'moras',
  'arandanos', 'refresco', 'gaseosa', 'cerveza', 'licuado', 'batido', 'malteada', 'bolillo', 'telera',
  'hamburguesa', 'proteina', 'vainilla', 'dona', 'donas',
];

/** Words that are ALSO English: count only with a non-weak MARKER, never toward STRONG >= 2 or the bare rule. */
export const SPANISH_SHARED_NOUNS: readonly string[] = [
  'pan', 'pasta', 'cereal', 'chocolate', 'mango', 'mangos', 'papaya', 'quinoa', 'coco', 'melon', 'te', 'sal',
  'crema', 'torta', 'tortas', 'cafe', 'vino', 'yogurt', 'pastel', 'pimiento', 'pimientos', 'jamon', 'papa',
  'dulce', 'pina', 'brocoli', 'garbanzos', 'sandwich', 'pizza', 'limon', 'limones',
];

/** An English token anywhere on the line blocks the bare-noun rule (`1 cup of arroz`). */
export const SPANISH_ENGLISH_ANCHORS: readonly string[] = [
  'a', 'an', 'the', 'of', 'with', 'and', 'or', 'on', 'in', 'plus', 'cup', 'cups', 'tbsp', 'tsp', 'tablespoon',
  'tablespoons', 'teaspoon', 'teaspoons', 'oz', 'ounce', 'ounces', 'lb', 'slice', 'slices', 'bowl', 'plate',
  'serving', 'servings', 'side', 'piece', 'pieces', 'glass', 'can', 'bottle', 'scoop', 'handful', 'large',
  'small', 'medium', 'half', 'chicken', 'rice', 'cheese', 'beef', 'pork', 'egg', 'eggs', 'bread', 'milk',
  'wrap', 'burrito', 'tacos', 'style', 'bar',
];

const MARKERS: ReadonlySet<string> = new Set([...SPANISH_MARKER_WORDS, ...Array.from(SPANISH_UNIT_TOKENS).map(fold)]);
const WEAK: ReadonlySet<string> = new Set(WEAK_FOR_SHARED_MARKERS);
const EXCLUDED: ReadonlySet<string> = new Set(SPANISH_EXCLUDED_WORDS);
const STRONG: ReadonlySet<string> = new Set(SPANISH_STRONG_NOUNS);
const SHARED: ReadonlySet<string> = new Set(SPANISH_SHARED_NOUNS);
const ANCHORS: ReadonlySet<string> = new Set(SPANISH_ENGLISH_ANCHORS);

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

function tokens(line: string): string[] {
  let s = fold(line.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ');
  s = ` ${s.split(/\s+/).filter(Boolean).join(' ')} `;
  for (const p of SPANISH_ENGLISH_MENU_PHRASES) s = s.split(` ${p} `).join(' ');
  return s.split(/\s+/).filter(Boolean);
}

export function isSpanishLine(line: string): boolean {
  if (!line) return false;
  const t = tokens(line).filter((x) => !EXCLUDED.has(x));
  const markers = new Set(t.filter((x) => MARKERS.has(x)));
  const strong = new Set(t.filter((x) => STRONG.has(x)));
  const hasShared = t.some((x) => SHARED.has(x));
  const strongMarker = Array.from(markers).some((m) => !WEAK.has(m));
  if (markers.size > 0 && strong.size > 0) return true;
  if (strongMarker && hasShared) return true;
  if (strong.size >= 2) return true;
  return strong.size >= 1 && !t.some((x) => ANCHORS.has(x));
}
