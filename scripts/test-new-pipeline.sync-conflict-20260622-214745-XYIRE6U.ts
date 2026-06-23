/**
 * Test parsing and mapping with the fixed egg whites logic
 */
import 'dotenv/config';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    console.log('=== Parsing Tests ===\n');

    const parseTests = [
        '3 egg whites, stirred until fluffy',
        '2 egg whites',
        '3 egg yolks',
        '1 cup fat free cheddar cheese',
        'chicken breast',
    ];

    for (const line of parseTests) {
        console.log(`"${line}"`);
        const parsed = parseIngredientLine(line);
        if (parsed) {
            console.log('  name:', parsed.name);
            console.log('  unit:', parsed.unit);
            console.log('  unitHint:', parsed.unitHint);
        } else {
            console.log('  FAILED - null');
        }
        console.log('');
    }

    console.log('\n=== Mapping Tests ===\n');

    const mapTests = [
        '3 egg whites, stirred until fluffy',
        'chicken breast',
        'aubergine',
    ];

    for (const line of mapTests) {
        console.log(`"${line}"`);
        try {
            const result = await mapIngredientWithFallback(line);
            if (result) {
                console.log('  Food:', result.foodName);
                console.log('  Confidence:', result.confidence?.toFixed(2));
                console.log('  Source:', result.source);
            } else {
                console.log('  FAILED - no result');
            }
        } catch (e) {
            console.log('  ERROR:', (e as Error).message);
        }
        console.log('');
    }

    console.log('Done!');
}

test().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
