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
- **Cooked state qualifiers** (for Sprint 3 readiness): `raw`, `cooked`, `uncooked`, `boiled`, `baked`, `grilled`, `drained`

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
- "To taste" phrases → `null` (explicitly rejected, not parsed)
- Non-ingredient text → `null`

### Special Cases

**"To taste" handling:**
- Phrases containing "to taste" return `null` (not parsed)
- This is intentional - "to taste" is not a quantifiable ingredient

**Pinch/Dash handling:**
- `pinch` and `dash` are recognized as volume units
- Parsed with `qty: 1` (default) when no quantity specified
- Example: `pinch of salt` → `{ qty: 1, unit: 'pinch', name: 'salt' }`
- Grams conversion will be handled in Sprint 3 via heuristic or override tables

## Return Type

```typescript
type ParsedIngredient = {
  qty: number;              // Quantity (always present, defaults to 1 for units like "pinch")
  multiplier: number;       // Multiplier for "x" patterns (defaults to 1)
  unit?: string | null;     // Normalized unit (e.g., 'cup', 'tbsp', 'g', 'pinch')
  rawUnit?: string | null; // Original unit string (if different from normalized)
  name: string;            // Ingredient name (always present)
  notes?: string | null;   // Optional notes
  qualifiers?: string[];   // Extracted qualifiers (e.g., ['large', 'diced', 'optional'])
  unitHint?: string | null; // Unit hint (e.g., 'yolk', 'clove', 'leaf')
}
```

**Note on `qty`:** The quantity is always a number. For phrases like "to taste", the parser returns `null` (not parsed). For units like "pinch" without an explicit quantity, `qty` defaults to `1`.

## Unicode Support

The parser normalizes various unicode spaces:

- Thin space (`\u2009`) → regular space
- Non-breaking space (`\u00A0`) → regular space
- En quad (`\u2000`) → regular space
- Em quad (`\u2001`) → regular space

## Normalization Order

The parser applies transformations in the following order:

1. **Unicode normalization** → Convert unicode spaces to regular spaces
2. **Whitespace normalization** → Trim and normalize whitespace
3. **Quantity parsing** → Extract and parse numeric quantities (fractions, ranges)
4. **Unit extraction** → Identify and normalize units
5. **Name extraction** → Extract core ingredient name
6. **Qualifier extraction** → Extract qualifiers from name and parentheses
7. **Unit hint extraction** → Extract unit hints (yolk, clove, leaf, etc.)

## Locale and Edge Cases

### Decimal Separators

- **Comma decimals**: Currently not supported (e.g., `1,5 cup` will not parse as 1.5)
- **Behavior**: Reject explicitly - comma decimals are not parsed
- **Future**: May add locale support in Sprint 4

### Trailing Periods

- **Units with periods**: `tsp.` and `tbsp.` are normalized to `tsp` and `tbsp`
- Example: `2 tsp. salt` → `{ qty: 2, unit: 'tsp', name: 'salt' }`

### Unit Plural Irregulars

- **Irregular plurals**: Handled correctly
- Examples:
  - `leaves` → normalized to `leaf` (unit hint)
  - `whites` → normalized to `white` (unit hint)
  - `yolks` → normalized to `yolk` (unit hint)

### Approximate Quantities

- **"About/approx"**: Currently parsed as qualifier
- Examples:
  - `about 2 cups flour` → `{ qty: 2, unit: 'cup', qualifiers: ['about'], name: 'flour' }`
  - `~2 cups flour` → `{ qty: 2, unit: 'cup', qualifiers: ['approx'], name: 'flour' }`
- **Note**: Quantity remains `2`; qualifier indicates approximation (useful for UI badges)

### Optional Ingredients

- **"Optional" qualifier**: Extracted from parentheses or comma-separated lists
- Example: `salt (optional)` → `{ qty: 1, qualifiers: ['optional'], name: 'salt' }`
- **Use case**: UI can display optional badge

### State/Cooked Qualifiers

The parser recognizes state/cooked qualifiers for future Sprint 3 readiness:

- **Raw state**: `raw`, `uncooked`
- **Cooked state**: `cooked`, `boiled`, `baked`, `grilled`, `drained`
- **Example**: `2 cups cooked rice` → `{ qty: 2, unit: 'cup', qualifiers: ['cooked'], name: 'rice' }`
- **Future use**: Sprint 3 will use these qualifiers to boost the correct FoodUnit (cooked vs uncooked)

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

## Performance

### Benchmark Target

- **Target**: p95 < 0.5 ms/line on dev box
- **Benchmark script**: `scripts/parser-bench.ts`
- **Reports**: `reports/parser-bench-YYYYMMDD.json`

Run benchmark:
```bash
npm run parser:bench
```

### Telemetry Hooks

The parser includes debug metrics (counters) for:
- When `unitHint` is set
- When parser falls back to default quantity
- These metrics are cheap and help with Sprint 3/Sprint 4 tuning

