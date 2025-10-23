# Curated Food Data (CSV → Pack → Seed)

**What is committed to Git?**
- ✅ CSVs and generated packs under `data/curated/` (small curated data you want in all environments)
- 🚫 Large USDA dumps under `data/usda/` are ignored by Git (use S3/Drive)

## CSV Header (Required for All Files)

```
id,name,brand,categoryId,densityGml,kcal100,protein100,carbs100,fat100,fiber100,sugar100,aliases,verification,popularity,units
```

## Workflow

### 1) Generate JSON pack(s) from CSV

```bash
npm run pack:fromcsv data/curated/oils.csv data/curated/pack-oils.json
```

### 2) Lint pack

```bash
npm run lint:pack -- data/curated/pack-oils.json
```

### 3) Seed a pack into your DB

```bash
npm run seed:curated data/curated/pack-oils.json
```

### 4) Seed ALL packs in data/curated/

```bash
npm run seed:curated:batch
```

## Vercel / Production Seeding

**Don't auto-seed on each deploy.** Instead, run the seeding command locally or in CI **against your prod DATABASE_URL** (Vercel "Production" env var).

```bash
DATABASE_URL="postgres://..." npm run seed:curated:batch
```

This writes curated foods to the production DB once. Repeat when you add new packs.

## Available Category Templates

- `oils.csv` - Cooking oils and fats
- `flours.csv` - Various flour types
- `proteins.csv` - Meats, eggs, protein powders
- `grains.csv` - Rice, quinoa, oats, etc.
- `legumes.csv` - Beans, lentils, chickpeas
- `dairy.csv` - Milk, yogurt, cheese
- `veg.csv` - Vegetables
- `fruit.csv` - Fruits
- `sauces.csv` - Condiments and sauces
- `cheeses.csv` - Various cheese types
- `protein_powders.csv` - Protein supplements
- `nut_butters.csv` - Peanut butter, almond butter, etc.

## CSV Format Notes

- **Aliases**: Semicolon-separated (e.g., `evoo; extra virgin olive oil`)
- **Units**: Leave blank for auto-defaults, or provide JSON array
- **Verification**: Usually `verified` for curated packs
- **Popularity**: 1-100 scale for search ranking
- **Density**: g/ml for volume conversions
- **Nutrition**: Per 100g values

## Example Units JSON

```json
[{"label":"1 tbsp","grams":13.6},{"label":"1 tsp","grams":4.5}]
```

## Adding New Foods

1. Edit the appropriate category CSV
2. Follow the header format exactly
3. Generate pack: `npm run pack:fromcsv data/curated/category.csv data/curated/pack-category.json`
4. Lint: `npm run lint:pack -- data/curated/pack-category.json`
5. Seed: `npm run seed:curated data/curated/pack-category.json`

## Troubleshooting

- **CSV parse errors**: Check for extra commas or quotes in data
- **Lint failures**: Fix missing units, zero macros, or duplicate names
- **Seeding errors**: Ensure database is migrated and accessible
- **Idempotency**: Safe to run multiple times, won't create duplicates