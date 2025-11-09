# Operations Guide

## Feature Flags & Rollout

### Overview

Feature flags allow safe, gradual rollout of new features with the ability to quickly rollback if issues arise.

### Available Flags

#### `ENABLE_PORTION_V2`

**Purpose**: Controls Portion V2 resolution logic using PortionOverride tables

**Default**: `false` (uses old logic)

**When enabled**: Uses new 5-tier fallback system (implemented in Sprint 3)

**Environment Variable**: `ENABLE_PORTION_V2`

**Values**: `"1"` or `"true"` to enable, anything else defaults to `false`

**Example**:
```bash
# Enable
ENABLE_PORTION_V2=1

# Disable (default)
ENABLE_PORTION_V2=false
# or simply omit the variable
```

#### `ENABLE_BRANDED_SEARCH`

**Purpose**: Enables branded food search via FDC API

**Default**: `false` (don't search branded foods)

**When enabled**: Allows searching branded foods via FDC API

**Environment Variable**: `ENABLE_BRANDED_SEARCH`

**Values**: `"1"` or `"true"` to enable, anything else defaults to `false`

**Example**:
```bash
# Enable
ENABLE_BRANDED_SEARCH=1

# Disable (default)
ENABLE_BRANDED_SEARCH=false
```

### How to Toggle

#### Local Development

1. Update `.env` file:
   ```bash
   ENABLE_PORTION_V2=1
   ENABLE_BRANDED_SEARCH=1
   ```

2. Restart the development server:
   ```bash
   npm run dev
   ```

#### Production/Staging

1. Update environment variables in your deployment platform (Vercel, Railway, etc.)
2. Redeploy the application
3. No database migrations required for flag toggles

### Monitoring

#### Metrics to Watch

When enabling `ENABLE_PORTION_V2`:
- **P@1 (Precision at 1)**: Should not drop > 1.5pp
- **MAE (Mean Absolute Error)**: Should not increase > 2g
- **Provisional Rate**: Monitor for changes in fallback behavior
- **Error Rates**: Watch for any increase in parsing/resolution errors

When enabling `ENABLE_BRANDED_SEARCH`:
- **FDC API Rate Limits**: Monitor for 429 errors
- **Cache Hit Rate**: Should remain >80% for repeated queries
- **Response Times**: Branded searches may be slower
- **Search Quality**: Monitor user feedback on search results

#### Telemetry Hooks

The parser includes debug metrics (counters) for:
- When `unitHint` is set
- When parser falls back to default quantity
- These metrics are cheap and help with tuning

### Rollback Plan

#### Quick Rollback (Flag Toggle)

1. **Toggle flag off** in environment variables
2. **Redeploy** application
3. **Verify** old behavior restored

**Time to rollback**: < 5 minutes

#### Full Rollback (Code Revert)

If flag toggle doesn't resolve issues:

1. **Revert commit** via Git:
   ```bash
   git revert <commit-hash>
   ```

2. **Deploy previous image** if using containerized deployment

3. **Verify** system behavior

**Time to rollback**: < 15 minutes

#### Migration Rollback

If database migrations are involved:

1. **Check migration status**:
   ```bash
   npx prisma migrate status
   ```

2. **Rollback migration**:
   ```bash
   npx prisma migrate resolve --rolled-back <migration-name>
   ```

3. **Revert schema changes** if needed

**Time to rollback**: Varies by migration complexity

### Best Practices

1. **Always test flags locally** before enabling in production
2. **Monitor metrics** for at least 24 hours after enabling
3. **Have rollback plan ready** before enabling
4. **Document flag behavior** in PR descriptions
5. **Use feature flags for gradual rollout** (e.g., 10% → 50% → 100%)

### Security & Configuration

#### FDC API Key Handling

- **Never commit** `FDC_API_KEY` to repository
- **Use environment variables** or secrets management
- **CI check**: Scripts verify no API keys in committed files
- **Documentation**: See `docs/USDA_SATURATION_README.md`

#### Rate Limiting

- **Default**: `FDC_RATE_LIMIT_PER_HOUR=1000` (safe default)
- **If missing**: System defaults to safe low value
- **Monitor**: Watch for 429 errors in logs

### Troubleshooting

#### Flag Not Taking Effect

1. **Check environment variable** is set correctly
2. **Restart application** (flags read at startup)
3. **Verify flag parsing** in `src/lib/flags.ts`
4. **Check logs** for flag values

#### Unexpected Behavior

1. **Verify flag state** in application logs
2. **Check feature flag logic** in code
3. **Review recent changes** to flag implementation
4. **Rollback if needed** using procedures above

### Related Documentation

- **Feature Flags**: `src/lib/flags.ts`
- **Parser Documentation**: `docs/s1-parser.md`
- **Evaluation System**: `docs/eval.md`
- **USDA Saturation**: `docs/USDA_SATURATION_README.md`

---

## Data Seeding Best Practices

### Verifying Food Existence with Fuzzy Matching

**IMPORTANT**: Always verify food existence with fuzzy matching before assuming foods are missing!

#### Why This Matters

In Sprint 2, we discovered that 12 of 21 "missing" foods actually existed with different USDA names. Fuzzy matching saved us from:
- ❌ Adding 12 duplicate foods
- ❌ 57% extra Sprint 5 work  
- ✅ Increased seed success rate from 58% to 81%

#### USDA Naming Conventions

USDA uses specific, verbose names:

| Common Name | Actual USDA Name |
|-------------|------------------|
| "Garlic" | `Garlic, raw` |
| "Onion" | `Onions, yellow, raw` |
| "Coconut Milk" | `Nuts, coconut milk, raw (liquid expressed from grated meat and water)` |
| "Pasta" | `Pasta, homemade, made with egg, cooked` |
| "Tomato" | `Tomatoes, red, ripe, raw, year round average` |

#### How to Verify Before Adding Foods

**1. Basic fuzzy search (case-insensitive):**

```typescript
const matches = await prisma.food.findMany({
  where: {
    name: {
      contains: 'garlic', // Use key term
      mode: 'insensitive'
    }
  },
  select: { name: true, source: true },
  take: 5
});
```

**2. Check with first word of food name:**

```typescript
// For "Coconut Oil", search "coconut"
// For "Fish Sauce", search "fish" or "sauce"
const searchTerm = foodName.split(' ')[0].toLowerCase();
```

**3. Look for common USDA patterns:**
- `"Food, state"` - e.g., `Garlic, raw`, `Onions, yellow, raw`
- `"Food, form, details"` - e.g., `Nuts, coconut milk, raw (...)`
- `"Food, brand/type"` - for commercial items
- `"Food, preparation"` - e.g., `Chicken, cooked, braised`

**4. Quick verification script:**

```bash
# Run this in your project directory
node -e "
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const foods = ['Garlic', 'Onion', 'Miso', 'Honey'];
  
  for (const food of foods) {
    const term = food.toLowerCase();
    const matches = await prisma.food.findMany({
      where: { name: { contains: term, mode: 'insensitive' } },
      select: { name: true },
      take: 3
    });
    
    console.log(\`\${food}:\`);
    if (matches.length > 0) {
      matches.forEach(m => console.log(\`  → \${m.name}\`));
    } else {
      console.log(\`  ❌ NOT FOUND\`);
    }
    console.log();
  }
  
  await prisma.\$disconnect();
}

check();
"
```

#### Sprint 2 Example Results

**Before fuzzy matching verification:**
- Gap list: 21 foods
- Overrides seeded: 66

**After fuzzy matching verification:**
- Gap list: 9 foods (12 found!)
- Overrides seeded: 92 (+39% improvement)

#### Best Practice Workflow

1. **Create seed data** with common food names
2. **Run seed script** once (will show "not found" items)
3. **Verify each "not found"** with fuzzy matching
4. **Update seed data** with correct USDA names
5. **Re-run seed script** to capture all available foods
6. **Document truly missing** foods for future addition

#### Adding New Foods

If foods are truly missing after verification:

1. **Use template format** for cleaner names:
   ```typescript
   await prisma.food.create({
     data: {
       name: 'Miso',
       source: 'template',
       // ... nutrition data
     }
   });
   ```

2. **Add FoodAlias entries** for common variations:
   ```typescript
   await prisma.foodAlias.createMany({
     data: [
       { foodId: misoId, alias: 'miso paste' },
       { foodId: misoId, alias: 'miso, white' },
       { foodId: misoId, alias: 'miso, red' },
     ]
   });
   ```

3. **Document in gap list** with priority and use cases

### Related Scripts

- **Portion Override Seed**: `npm run seed:portion-overrides`
- **Curated Food Seed**: `npm run seed:curated`
- **USDA Import**: `npm run usda:import`
- **Verify Seeding**: `npm run verify:seeding`

