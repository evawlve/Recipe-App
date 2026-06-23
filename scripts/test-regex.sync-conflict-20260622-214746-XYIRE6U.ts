// Test the regex pattern
const descriptions = [
    "2 tbsp (30 g)",
    "100g",
    "1 cup",
    "2 tablespoons",
    "serving",
];

const pattern = /(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml|floz)/i;

for (const desc of descriptions) {
    const match = desc.match(pattern);
    if (match) {
        console.log(`"${desc}" -> amount: ${match[1]}, unit: ${match[2]}`);
    } else {
        console.log(`"${desc}" -> NO MATCH`);
    }
}
