import 'dotenv/config';
import * as fs from 'fs';
import * as zlib from 'zlib';

async function main() {
    const stream = fs.createReadStream('data/openfoodfacts.csv.gz')
        .pipe(zlib.createGunzip());

    let buffer = '';
    let headerParsed = false;
    let headers: string[] = [];
    let rowCount = 0;

    const KEY_COLS = new Set([
        'code','product_name','brands','countries_tags',
        'energy-kcal_100g','proteins_100g','carbohydrates_100g','fat_100g',
        'serving_size','scans_n','completeness','lang','main_category_en',
        'energy_100g','fat_100g','saturated-fat_100g','carbohydrates_100g',
        'sugars_100g','fiber_100g','proteins_100g','salt_100g'
    ]);

    for await (const chunk of stream) {
        buffer += chunk.toString('utf-8');
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
            if (!line.trim()) continue;

            if (!headerParsed) {
                headers = line.split('\t');
                console.log(`Total columns: ${headers.length}`);
                headers.forEach((h, i) => console.log(`  ${i}: ${h.trim()}`));
                headerParsed = true;
                continue;
            }

            if (rowCount === 0) {
                console.log('\n--- First data row (key fields) ---');
                const vals = line.split('\t');
                headers.forEach((h, i) => {
                    if (KEY_COLS.has(h.trim())) {
                        console.log(`  ${h.trim()}: ${(vals[i] || '').trim().slice(0, 80)}`);
                    }
                });
            }
            rowCount++;
            if (rowCount >= 2) break;
        }
        if (rowCount >= 2) break;
    }
}

main().catch(e => { console.error(e); process.exit(1); });
