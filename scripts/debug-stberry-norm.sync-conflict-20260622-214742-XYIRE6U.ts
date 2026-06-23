#!/usr/bin/env npx tsx

import 'dotenv/config';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

async function main() {
    const inputs = [
        '2 cup stberry halves',
        'stberry'
    ];

    for (const input of inputs) {
        console.log(`\nNormalizing: "${input}"`);
        const result = await aiNormalizeIngredient(input);
        console.log(JSON.stringify(result, null, 2));
    }
}

main().catch(console.error);
