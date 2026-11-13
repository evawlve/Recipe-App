/**
 * isSpanishLine() pins (C6970 D30). TRUE: Spanish lines from the s422 read (the 40-line arm cut plus the
 * bare-noun and modifier lines the row exists for). FALSE: the whole s410 regression list and the English
 * menu / brand lines the refute (s412) showed a naive lexicon would flip.
 */
import {
  isSpanishLine,
  SPANISH_STRONG_NOUNS,
  SPANISH_SHARED_NOUNS,
  SPANISH_EXCLUDED_WORDS,
} from '../spanish-detect';

const SPANISH_TRUE = [
  "un café con leche",
  "un plátano",
  "una torta de jamón",
  "medio pan de elote",
  "una medida de proteína ascent de vainilla",
  "leche con chocolate",
  "pollo y arroz",
  "pan con mantequilla",
  "cafe con leche",
  "huevos con jamon",
  "leche de almendra sin azúcar",
  "una pechuga de pollo a la parrilla",
  "una ensalada césar",
  "una manzana",
  "una taza de avena",
  "frijoles",
  "una taza de arroz con pollo",
  "dos tamales de pollo",
  "una manzana y un platano",
  "mitad de una orden de arroz frito",
  "un vaso de leche con chocolate",
  "pollo",
  "2 cucharadas de cream de cacahuate",
  "dos tortillas de harina",
  "crema de cacahuate",
  "un frappuccino de caramelo grande de starbucks",
  "un café",
  "dos huevos",
  "arroz",
  "un pan dulce",
  "un bolillo",
  "una sopa de fideo",
  "un tazón de cereal raisin bran",
  "una dona glaseada de krispy kreme",
  "un vaso de leche fairlife de chocolate",
  "huevos",
  "leche",
  "2 huevos",
  "100 g de pollo",
  "leche descremada",
  "arroz con pollo",
  "un yogurt griego sin grasa",
  "tres rebanadas de pan integral",
  "tres tortillas de harina la banderita",
  "sal de uvas",
  "media taza de fresas",
  "dos tazas de leche",
  "dos rebanadas de pan bimbo",
  "frijoles refritos",
];

const ENGLISH_FALSE = [
  "pico de gallo",
  "tres leches cake",
  "pan seared salmon",
  "tortilla chips",
  "queso fresco",
  "chili con carne",
  "a cup of cafe au lait",
  "pan",
  "queso",
  "pan dulce",
  "media crema",
  "pollo tropical bowl",
  "noosa mango yogurt",
  "mango yogurt",
  "chocolate yogurt",
  "chocolate cereal",
  "mango papaya smoothie",
  "coco melon",
  "chocolate pasta",
  "chocolate quinoa bar",
  "pasta with mango",
  "quinoa salad with mango",
  "dulce de leche ice cream",
  "haagen dazs dulce de leche",
  "media noche sandwich",
  "uno pizzeria deep dish pizza",
  "sheet pan chicken thighs",
  "pan pizza",
  "cafe au lait",
  "del taco burrito",
  "dos equis beer",
  "cinco de mayo margarita",
  "papa johns pizza",
  "pina colada",
  "jamon serrano",
  "pastel de nata",
  "lays limon",
  "1 cup of arroz",
  "2 slices of pan",
  "two eggs",
  "1 cup of milk",
];

const S410_REGRESSION = [
  "1 cup cooked rice",
  "1 cup cooked pasta",
  "1 cup cooked black beans",
  "1 cup white rice",
  "1 cup cooked quinoa",
  "1 cup cooked oats",
  "half a cup of cooked rolled oats",
  "a cup of cooked oatmeal",
  "half a cup of cooked brown rice",
  "3/4 cup cooked quinoa",
  "2 cups cooked jasmine rice",
  "a cup of cooked lentils",
  "1 cup cooked barley",
  "a cup of cooked farro",
  "half a cup of cooked couscous",
  "a cup of cooked bulgur",
  "a cup of cooked wild rice",
  "a cup of cooked chickpeas",
  "a cup of cooked teff",
  "1.5 cups cooked spaghetti",
  "a cup of cooked brown rice",
  "a cup of cooked basmati rice",
  "a cup of cooked pinto beans",
  "a cup of cooked kidney beans",
  "a cup of cooked millet",
  "a cup of cooked buckwheat",
  "a cup of cooked egg noodles",
  "a cup of cooked penne",
  "a cup of cooked sticky rice",
  "a cup of cooked red lentils",
  "a cup of cooked split peas",
  "a cup of cooked orzo",
  "a cup of cooked soba noodles",
  "a cup of cooked ramen noodles",
  "2 cups cooked quinoa",
  "a bowl of cooked rice",
  "a serving of cooked pasta",
  "one cup of cooked quinoa",
  "4 oz of cooked pasta",
  "half a cup of cooked black beans",
  "1 cup oats",
  "a bowl of oatmeal",
  "a cup of rice",
  "oatmeal made with milk",
  "sheet pan chicken thighs",
  "Homemade Beef Stew",
  "a cup of dry rolled oats",
  "100 g uncooked rice",
  "dry quinoa",
  "a cup of oats",
  "oatmeal",
  "rolled oats",
  "200g rice",
  "half cup oats dry",
  "steamed oat milk",
  "a cup of rice vinegar",
  "cooked rice flour",
  "a bowl of rice krispies",
  "a cup of fried rice",
  "a bowl of steamed rice",
  "a cup of baked oatmeal",
  "a cup of roasted barley",
  "a cup of uncooked rice",
  "half a cup of uncooked quinoa",
  "a cup of cooked glutinous rice",
  "a cup of dry quinoa",
  "a cup of cooked jasmine rice",
  "a cup of basmati rice",
];

describe('isSpanishLine', () => {
  it.each(SPANISH_TRUE)('TRUE: %s', (line) => {
    expect(isSpanishLine(line)).toBe(true);
  });

  it.each(ENGLISH_FALSE)('FALSE: %s', (line) => {
    expect(isSpanishLine(line)).toBe(false);
  });

  it.each(S410_REGRESSION)('FALSE (s410 regression list): %s', (line) => {
    expect(isSpanishLine(line)).toBe(false);
  });

  it('reads accents, case and punctuation the same as the plain form', () => {
    expect(isSpanishLine('  UN Vaso de LECHE! ')).toBe(true);
    expect(isSpanishLine('Una Ensalada César')).toBe(true);
  });

  it('is false for empty input', () => {
    expect(isSpanishLine('')).toBe(false);
  });

  it('keeps the lexicon lists disjoint (a word is STRONG, SHARED or EXCLUDED, never two)', () => {
    const strong = new Set(SPANISH_STRONG_NOUNS);
    const shared = new Set(SPANISH_SHARED_NOUNS);
    const excluded = new Set(SPANISH_EXCLUDED_WORDS);
    for (const w of strong) { expect(shared.has(w)).toBe(false); expect(excluded.has(w)).toBe(false); }
    for (const w of shared) { expect(excluded.has(w)).toBe(false); }
    for (const w of [...strong, ...shared, ...excluded]) expect(w).toMatch(/^[a-z0-9]+$/);
  });
});
