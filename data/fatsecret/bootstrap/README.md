# FatSecret Cache Bootstrap Lists

Drop JSONL manifests in this folder to hydrate FatSecret staples before the migration cutover.

Each line should be a JSON object with at least `fatsecretId`:

```json
{"fatsecretId":"123456","legacyFoodId":"seed_olive_oil_curated","source":"gold","note":"Extra virgin olive oil"}
```

Recommended files:
- `gold.jsonl`: foods referenced by eval/gold CSVs
- `curated.jsonl`: foods from `data/curated` or `myfoods.csv`
- `staples.jsonl`: ad-hoc FatSecret IDs you want cached immediately

Run `npm run fatsecret:cache:bootstrap -- --preset=gold --preset=curated` once you populate these files.
