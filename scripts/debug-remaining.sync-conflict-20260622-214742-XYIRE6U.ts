import { resolveIngredient } from "@/lib/resolve-ingredient";

const testCases = [
  "2 large yellow zucchini",
  "1 large red onion",
  "18 organic grape tomatoes",
  "4 slice ham",
  "1 slice mozzarella",
  "0.33 second spray cooking spray",
  "1 mini avocado",
  "1 tbsp rice vinegar",
  "1 tsp garlic powder",
  "1 tsp onion powder",
  "1 cup pitted cherries",
  "1 tbsp sesame seed oil"
];

async function run() {
  for (const tc of testCases) {
    console.log(`\n\n=== ${tc} ===`);
    try {
      const result = await resolveIngredient(tc);
      console.log(`Mapped: ${result.name} (${result.knownMacros?.calories} kcal / ${result.knownMacros?.grams}g)`);
      if (result.matchedServing) {
        console.log(`Serving: ${result.matchedServing.amount} ${result.matchedServing.measurement_description}`);
      }
    } catch (e) {
      console.log(`Error: ${e}`);
    }
  }
}

run().catch(console.error);
