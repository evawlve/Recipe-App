const { execSync } = require('child_process');

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

for (const tc of testCases) {
  console.log(`\n=== ${tc} ===`);
  try {
    const output = execSync(`npx tsx src/scripts/debug-ingredient.ts "${tc}"`, { encoding: 'utf-8', stdio: 'pipe' });
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('Mapped:') || line.includes('grams: ') || line.includes('Selected:') || line.includes('Error')) {
        console.log(line.trim());
      }
    }
  } catch (e) {
    if (e.stdout) {
       const lines = e.stdout.split('\n');
       for (const line of lines) {
         if (line.includes('Mapped:') || line.includes('grams: ') || line.includes('Selected:') || line.includes('Error')) {
           console.log(line.trim());
         }
       }
    }
    console.log(`Failed to run for ${tc}`);
  }
}
