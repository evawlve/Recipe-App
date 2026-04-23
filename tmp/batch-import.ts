import { execSync } from 'child_process';

const queries = [
    'chicken', 'soup', 'pasta', 'beef', 'salad', 
    'breakfast', 'dessert', 'keto', 'vegan', 'snack',
    'pork', 'fish', 'rice', 'bread', 'cake',
    'cookies', 'pie', 'smoothie', 'pizza', 'sandwich'
];
const authorId = '279a6119-a377-42b4-9ee9-1f08169a8e71';
const maxPerQuery = 50; 

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    for (const q of queries) {
        console.log(`\n\n--- Importing recipes for: ${q} ---`);
        try {
            execSync(`npx tsx scripts/fatsecret-recipe-import.ts --query "${q}" --max-results ${maxPerQuery} --author-id ${authorId}`, {
                stdio: 'inherit'
            });
        } catch (e) {
            console.error(`Error importing ${q}, moving to next in 5s...`);
            await sleep(5000);
        }
        await sleep(2000);
    }
}

run();
