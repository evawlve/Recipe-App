#!/usr/bin/env ts-node
"use strict";
/**
 * USDA bulk import CLI script
 * Usage: ts-node scripts/usda-import.ts <path-to-json> [options]
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const importer_1 = require("../src/ops/usda/importer");
const normalize_1 = require("../src/ops/usda/normalize");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function parseArgs() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        console.log(`
USDA Bulk Import Script

Usage: ts-node scripts/usda-import.ts <path-to-json> [options]

Options:
  --dry-run              Don't actually import, just show what would be imported
  --batch-size <number>  Process in batches of this size (default: 100)
  --no-skip-duplicates   Don't skip duplicate foods
  --help, -h             Show this help message

Examples:
  ts-node scripts/usda-import.ts ./data/usda-sr-legacy.json
  ts-node scripts/usda-import.ts ./data/usda-sr-legacy.json --dry-run
  ts-node scripts/usda-import.ts ./data/usda-sr-legacy.json --batch-size 50
`);
        process.exit(0);
    }
    const filePath = args[0];
    const options = {
        dryRun: args.includes('--dry-run'),
        batchSize: parseInt(args[args.indexOf('--batch-size') + 1]) || 100,
        skipDuplicates: !args.includes('--no-skip-duplicates'),
        help: false
    };
    return { filePath, options };
}
async function loadData(filePath) {
    console.log(`📁 Loading data from: ${filePath}`);
    if (!fs_1.default.existsSync(filePath)) {
        console.error(`❌ File not found: ${filePath}`);
        process.exit(1);
    }
    const ext = path_1.default.extname(filePath).toLowerCase();
    let rawData;
    try {
        if (ext === '.json') {
            rawData = JSON.parse(fs_1.default.readFileSync(filePath, 'utf-8'));
        }
        else if (ext === '.csv') {
            // CSV parsing would go here
            console.error('❌ CSV support not implemented yet');
            process.exit(1);
        }
        else {
            console.error('❌ Unsupported file format. Use .json or .csv');
            process.exit(1);
        }
    }
    catch (error) {
        console.error('❌ Failed to parse file:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
    // Handle different JSON structures
    let foods;
    if (rawData.foods) {
        foods = rawData.foods;
    }
    else if (Array.isArray(rawData)) {
        foods = rawData;
    }
    else {
        console.error('❌ Invalid JSON structure. Expected array or object with "foods" property');
        process.exit(1);
    }
    console.log(`📊 Found ${foods.length} food items`);
    return foods;
}
async function convertToUsdaRows(foods) {
    console.log('🔄 Converting FDC data to USDA format...');
    const usdaRows = [];
    let converted = 0;
    let skipped = 0;
    for (const food of foods) {
        const usdaRow = (0, normalize_1.fdcToUsdaRow)(food);
        if (usdaRow) {
            usdaRows.push(usdaRow);
            converted++;
        }
        else {
            skipped++;
        }
        if (converted % 1000 === 0) {
            console.log(`  Converted ${converted}/${foods.length} items...`);
        }
    }
    console.log(`✅ Converted ${converted} items, skipped ${skipped}`);
    return usdaRows;
}
async function main() {
    console.log('🌱 USDA Bulk Import Script');
    console.log('==========================');
    const { filePath, options } = parseArgs();
    if (options.dryRun) {
        console.log('🔍 DRY RUN MODE - No data will be imported');
    }
    try {
        // Load and convert data
        const foods = await loadData(filePath);
        const usdaRows = await convertToUsdaRows(foods);
        if (usdaRows.length === 0) {
            console.log('❌ No valid food items found');
            process.exit(1);
        }
        // Import the data
        console.log('📥 Starting import...');
        const result = await (0, importer_1.importUsdaGenerics)(usdaRows, options);
        // Show results
        console.log('\n📈 Import Results:');
        console.log(`  ✅ Created: ${result.created}`);
        console.log(`  ⏭️  Skipped: ${result.skipped}`);
        console.log(`  ❌ Errors: ${result.errors}`);
        console.log(`  📊 Total: ${result.created + result.skipped + result.errors}`);
        if (result.errors > 0) {
            console.log('\n⚠️  Some items failed to import. Check logs for details.');
        }
        if (options.dryRun) {
            console.log('\n🔍 This was a dry run. Use without --dry-run to actually import.');
        }
        else {
            console.log('\n🎉 Import completed successfully!');
        }
    }
    catch (error) {
        console.error('❌ Import failed:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }
}
// Run the script
if (require.main === module) {
    main().catch((error) => {
        console.error('❌ Fatal error:', error);
        process.exit(1);
    });
}
