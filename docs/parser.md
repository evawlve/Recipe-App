# Ingredient Parser Documentation

## Overview

The ingredient parser (`parseIngredientLine`) is a robust parser that extracts structured data from free-form ingredient text. It handles various formats including fractions, ranges, qualifiers, unit hints, and noise.

## Supported Input Formats

The parser supports a wide variety of ingredient formats:

- **Simple quantities**: `2 cups flour`, `1 tbsp olive oil`
- **Unicode fractions**: `½ cup milk`, `2½ cups flour`, `¼ tsp salt`
- **Ranges**: `2-3 eggs`, `2–3 cups flour`, `1½-2 tsp vanilla`
- **Qualifiers**: `3 large boneless skinless chicken breasts`
- **Unit hints**: `2 egg yolks`, `5 romaine leaves`, `2 cloves garlic`
- **Multipliers**: `2 x 200g chicken`, `2x200g chicken`
- **Parentheses**: `1 cup onion (diced)`, `1 (14 oz) can tomatoes`
- **Comma-separated qualifiers**: `1 cup, packed, brown sugar`, `2 cloves garlic, minced`

## Parsing Examples

### Fractions

The parser supports unicode fractions and mixed numbers:

```typescript
parseIngredientLine('2½ cups flour')
// { qty: 2.5, unit: 'cup', name: 'flour' }

parseIngredientLine('½ cup oats')
// { qty: 0.5, unit: 'cup', name: 'oats' }

parseIngredientLine('1 ½ cup milk')
// { qty: 1.5, unit: 'cup', name: 'milk' }
```

**Supported unicode fractions**: ½, ¼, ¾, ⅓, ⅔, ⅛, ⅜, ⅝, ⅞

### Ranges

Ranges are automatically averaged:

```typescript
parseIngredientLine('2-3 large eggs')
// { qty: 2.5, qualifiers: ['large'], name: 'eggs' }

parseIngredientLine('2–3 cups flour')
// { qty: 2.5, unit: 'cup', name: 'flour' }

parseIngredientLine('1½-2 tsp vanilla extract')
// { qty: 1.75, unit: 'tsp', name: 'vanilla extract' }
```

**Supported range separators**: `-`, `–` (en-dash), `—` (em-dash), `to`

### Qualifiers

Qualifiers are extracted from various positions in the ingredient line:

```typescript
parseIngredientLine('3 large boneless skinless chicken breasts')
// { qty: 3, qualifiers: ['large', 'boneless', 'skinless'], name: 'chicken breasts' }

parseIngredientLine('1 cup onion (diced)')
// { qty: 1, unit: 'cup', qualifiers: ['diced'], name: 'onion' }

parseIngredientLine('1 cup, packed, brown sugar')
// { qty: 1, unit: 'cup', qualifiers: ['packed'], name: 'brown sugar' }

parseIngredientLine('2 cloves garlic, minced')
// { qty: 2, qualifiers: ['minced'], name: 'garlic' }
```

### Unit Hints

Unit hints are extracted for piece-like units:

```typescript
parseIngredientLine('2 egg yolks')
// { qty: 2, unitHint: 'yolk', name: 'egg' }

parseIngredientLine('5 romaine leaves')
// { qty: 5, unitHint: 'leaf', name: 'romaine' }

parseIngredientLine('2 cloves garlic')
// { qty: 2, unitHint: 'clove', name: 'garlic' }
```

### Multipliers

The parser handles "x" multipliers:

```typescript
parseIngredientLine('2 x 200g chicken')
// { qty: 2, multiplier: 200, unit: 'g', name: 'chicken' }

parseIngredientLine('2x200g chicken')
// { qty: 2, multiplier: 200, unit: 'g', name: 'chicken' }
```

### Noise Handling

The parser gracefully handles non-ingredient text:

```typescript
parseIngredientLine('---')
// null

parseIngredientLine('to taste salt')
// null

parseIngredientLine('')
// null
```

## Recognized Qualifiers

### Size Qualifiers
- `large`, `small`, `medium`

### Preparation Qualifiers
- `raw`, `cooked`
- `diced`, `chopped`, `minced`, `sliced`, `grated`, `shredded`
- `finely`, `coarsely`, `roughly`
- `finely chopped`, `finely minced`, `coarsely chopped`, `roughly chopped`

### Meat Qualifiers
- `boneless`, `skinless`, `bone-in`, `skin-on`

### Packing Qualifiers
- `packed`, `loose`, `heaping`, `level`

### State Qualifiers
- `fresh`, `frozen`, `dried`, `canned`

### Form Qualifiers
- `whole`, `halved`, `quartered`
- `peeled`, `unpeeled`
- `seeded`, `unseeded`
- `stemmed`, `destemmed`

## Recognized Unit Hints

Unit hints are extracted for piece-like units that don't have standard mass/volume equivalents:

- `yolk` / `yolks` - for egg yolks
- `white` / `whites` - for egg whites
- `leaf` / `leaves` - for leafy vegetables
- `clove` / `cloves` - for garlic cloves
- `sheet` / `sheets` - for nori sheets
- `stalk` / `stalks` - for celery stalks
- `slice` / `slices` - for bread slices
- `piece` / `pieces` - for generic pieces

## Error Handling

The parser is designed to never throw errors. Instead, it returns `null` for invalid or non-ingredient input:

- Empty strings → `null`
- Whitespace-only strings → `null`
- Separator lines (`---`, `===`) → `null`
- "To taste" phrases → `null`
- Non-ingredient text → `null`

## Return Type

```typescript
type ParsedIngredient = {
  qty: number;              // Quantity (always present, defaults to 1)
  multiplier: number;       // Multiplier for "x" patterns (defaults to 1)
  unit?: string | null;     // Normalized unit (e.g., 'cup', 'tbsp', 'g')
  rawUnit?: string | null; // Original unit string (if different from normalized)
  name: string;            // Ingredient name (always present)
  notes?: string | null;   // Optional notes
  qualifiers?: string[];   // Extracted qualifiers
  unitHint?: string | null; // Unit hint (e.g., 'yolk', 'clove', 'leaf')
}
```

## Unicode Support

The parser normalizes various unicode spaces:

- Thin space (`\u2009`) → regular space
- Non-breaking space (`\u00A0`) → regular space
- En quad (`\u2000`) → regular space
- Em quad (`\u2001`) → regular space

## Before/After Examples

### Before (Basic Parser)
```typescript
parseIngredientLine('2-3 large eggs')
// { qty: 2, unit: null, name: '3 large eggs' } // Incorrect
```

### After (Enhanced Parser)
```typescript
parseIngredientLine('2-3 large eggs')
// { qty: 2.5, qualifiers: ['large'], name: 'eggs' } // Correct
```

### Before (Basic Parser)
```typescript
parseIngredientLine('2½ cups flour')
// { qty: 2, unit: null, name: '½ cups flour' } // Incorrect
```

### After (Enhanced Parser)
```typescript
parseIngredientLine('2½ cups flour')
// { qty: 2.5, unit: 'cup', name: 'flour' } // Correct
```

### Before (Basic Parser)
```typescript
parseIngredientLine('2 egg yolks')
// { qty: 2, unit: null, name: 'egg yolks' } // Missing unit hint
```

### After (Enhanced Parser)
```typescript
parseIngredientLine('2 egg yolks')
// { qty: 2, unitHint: 'yolk', name: 'egg' } // Correct with unit hint
```

## Related Files

- `src/lib/parse/ingredient-line.ts` - Main parser implementation
- `src/lib/parse/quantity.ts` - Quantity parsing (fractions, ranges)
- `src/lib/parse/qualifiers.ts` - Qualifier extraction
- `src/lib/parse/unit-hint.ts` - Unit hint extraction
- `src/lib/parse/unit.ts` - Unit normalization

## Testing

The parser has comprehensive test coverage:

- **Core tests**: 25 deterministic test cases (`ingredient-line-core.test.ts`)
- **Property tests**: Property-based fuzz testing (`ingredient-line-property.test.ts`)
- **Integration tests**: End-to-end parsing and resolution (`integration.test.ts`)

Run tests:
```bash
npm test src/lib/parse
```

