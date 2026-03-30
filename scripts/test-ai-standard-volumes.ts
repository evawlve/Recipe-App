import { estimateAmbiguousServing } from '../src/lib/ai/ambiguous-serving-estimator';

async function main() {
  const result1 = await estimateAmbiguousServing({
    foodName: 'Greek Nonfat Yogurt Plain',
    brandName: 'Giant Food',
    unit: 'cup',
  });
  console.log('Greek Yogurt Cup:', result1);

  const result2 = await estimateAmbiguousServing({
    foodName: 'Nutritional Yeast',
    unit: 'tbsp',
  });
  console.log('Nutritional Yeast Tbsp:', result2);
}

main().catch(console.error);
