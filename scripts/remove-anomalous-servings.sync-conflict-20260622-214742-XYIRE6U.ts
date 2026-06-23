/**
 * Remove Anomalous Serving Entries
 * 
 * Removes entries identified as incorrectly estimated by the Ollama model
 * and outputs a list of removed entries for potential recalculation.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ServingEntry {
    cacheType: string;
    foodId: string;
    foodName: string;
    brandName: string | null;
    servingDescription: string;
    grams: number;
    source: string;
    confidence: number | null;
    note: string | null;
    createdAt: string;
}

// Define which entries should be removed based on analysis
function shouldRemoveEntry(entry: ServingEntry): { remove: boolean; reason: string } {
    const { foodName, servingDescription, grams, source } = entry;
    const servingLower = servingDescription.toLowerCase();

    // Skip manually fixed entries and verified FDC entries
    if (source === 'manual_fix' || (source === 'fdc' && entry.confidence === null)) {
        return { remove: false, reason: '' };
    }

    // === CONFIRMED ISSUES TO REMOVE ===

    // 1. Zucchini Lasagna with impossibly low weights (11-16g for a serving)
    if (/zucchini lasagna/i.test(foodName) && /small|medium|large/i.test(servingDescription) && grams < 50) {
        return { remove: true, reason: 'Zucchini lasagna serving impossibly low' };
    }

    // 2. Zucchini Soup with impossibly low weights
    if (/zucchini soup/i.test(foodName) && /small|medium|large/i.test(servingDescription) && grams < 50) {
        return { remove: true, reason: 'Zucchini soup serving impossibly low' };
    }

    // 3. Scallions/Spring Onions with bundle-sized weights (should be per stalk)
    if (/scallion|spring onion/i.test(foodName) && /medium|large/i.test(servingDescription) && grams > 50) {
        return { remove: true, reason: 'Scallion/spring onion weight suggests bundle instead of single stalk' };
    }

    // 4. Cooked Red Peppers with impossibly low "medium" weight
    if (/cooked.*pepper|pepper.*cooked/i.test(foodName) && /medium/i.test(servingDescription) && grams < 20) {
        return { remove: true, reason: 'Cooked pepper medium weight too low' };
    }

    // 5. Zucchini Cake/Fritter with impossibly low weights (these are baked goods, not raw zucchini)
    if (/zucchini (cake|fritter)/i.test(foodName) && /small|medium|large/i.test(servingDescription) && grams < 30) {
        return { remove: true, reason: 'Zucchini cake/fritter serving impossibly low' };
    }

    // 6. Orange Soda "large" at 2000g (excessive)
    if (/orange soda/i.test(foodName) && /large/i.test(servingDescription) && grams >= 2000) {
        return { remove: true, reason: 'Orange soda large serving excessive (2kg)' };
    }

    // 7. Any soup/stew with small/medium/large servings under 50g
    if (/soup|stew|chili/i.test(foodName) && /small|medium|large/i.test(servingDescription) && grams < 50) {
        return { remove: true, reason: 'Soup/stew serving impossibly low' };
    }

    // 8. Any lasagna/casserole with small/medium/large under 50g
    if (/lasagna|casserole/i.test(foodName) && /small|medium|large/i.test(servingDescription) && grams < 50) {
        return { remove: true, reason: 'Lasagna/casserole serving impossibly low' };
    }

    // 9. Whole leaf spinach "medium" at 3g (should be more for a serving)
    if (/whole leaf spinach/i.test(foodName) && /medium/i.test(servingDescription) && grams < 10) {
        return { remove: true, reason: 'Whole leaf spinach medium serving too low' };
    }

    // 10. Young Green Onions (Tops Only) medium/large at 10-12g when it should be for a bundle
    if (/young green onion.*tops only/i.test(foodName) && /medium|large/i.test(servingDescription) && grams <= 12) {
        return { remove: true, reason: 'Young green onion tops serving inconsistent' };
    }

    return { remove: false, reason: '' };
}

function main() {
    const logsDir = path.join(__dirname, '..', 'logs');
    const inputFile = path.join(logsDir, 'ai-generated-servings.json');
    const outputFile = path.join(logsDir, 'ai-generated-servings.json'); // Overwrite
    const backupFile = path.join(logsDir, 'ai-generated-servings.backup.json');
    const removedFile = path.join(logsDir, 'removed-serving-entries.json');

    console.log('Loading ai-generated-servings.json...');
    const entries: ServingEntry[] = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    console.log(`Loaded ${entries.length} entries`);

    // Create backup
    console.log('Creating backup...');
    fs.writeFileSync(backupFile, JSON.stringify(entries, null, 2));
    console.log(`Backup created: ${backupFile}`);

    // Filter entries
    const removedEntries: Array<ServingEntry & { removalReason: string }> = [];
    const keptEntries: ServingEntry[] = [];

    for (const entry of entries) {
        const { remove, reason } = shouldRemoveEntry(entry);
        if (remove) {
            removedEntries.push({ ...entry, removalReason: reason });
        } else {
            keptEntries.push(entry);
        }
    }

    console.log(`\nRemoval Summary:`);
    console.log(`  Removed: ${removedEntries.length}`);
    console.log(`  Kept: ${keptEntries.length}`);

    // Write cleaned file
    fs.writeFileSync(outputFile, JSON.stringify(keptEntries, null, 2));
    console.log(`\nWrote cleaned data to ${outputFile}`);

    // Write removed entries for reference
    fs.writeFileSync(removedFile, JSON.stringify(removedEntries, null, 2));
    console.log(`Wrote removed entries to ${removedFile}`);

    // Print removed entries summary
    console.log('\n=== REMOVED ENTRIES ===');

    // Group by reason
    const byReason: Record<string, typeof removedEntries> = {};
    for (const entry of removedEntries) {
        if (!byReason[entry.removalReason]) {
            byReason[entry.removalReason] = [];
        }
        byReason[entry.removalReason].push(entry);
    }

    for (const [reason, items] of Object.entries(byReason)) {
        console.log(`\n${reason} (${items.length} entries):`);
        for (const item of items.slice(0, 5)) {
            console.log(`  - ${item.foodName} | "${item.servingDescription}" = ${item.grams}g`);
        }
        if (items.length > 5) {
            console.log(`  ... and ${items.length - 5} more`);
        }
    }

    console.log('\n✅ Done! The problematic entries have been removed.');
    console.log('Run your serving recalculation process to regenerate correct estimates.');
}

main();
