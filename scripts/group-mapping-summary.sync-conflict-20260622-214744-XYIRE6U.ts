import * as fs from 'fs';
import * as path from 'path';

function run() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error('Usage: ts-node group-mapping-summary.ts <path-to-mapping-summary>');
        process.exit(1);
    }

    const logPath = args[0];
    if (!fs.existsSync(logPath)) {
        console.error(`File not found: ${logPath}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(logPath, 'utf8').split('\n');

    // Mapped Food Name -> Set/Map of formatted query lines with a frequency count
    // The key is the Mapped Food Name (e.g., "Salt", "", "Broccoli")
    const groups: Record<string, Record<string, number>> = {};
    let totalLines = 0;
    
    // Regex to parse typically: ✓ {early_cache} [0.98] "1 tbsp olive oil" → "Olive Oil" | ...
    // or ✗ [0.00] "Dry Mustard" → "" [LOW_CONF]
    const lineRegex = /^(✓|✗|⚠)(?:\s+\{[^}]+\})?\s+\[([\d.]+)\]\s+"([^"]+)"\s+→\s+"([^"]*)"(?:\s+\|\s+(.*))?$/;

    for (const line of lines) {
        if (!line || line.startsWith('#')) continue;
        
        const match = line.match(lineRegex);
        if (match) {
            totalLines++;
            const [, status, _, rawQuery, mappedName, data] = match;
            
            // Reconstruct the remaining string without the mappedName
            const outputLine = `${status} "${rawQuery}"${data ? ' | ' + data : ''}`;
            
            // Use special keys for unmapped/failed
            const groupKey = mappedName && mappedName.trim() !== "" ? mappedName : "(UNMAPPED/FAILED)";

            if (!groups[groupKey]) {
                groups[groupKey] = {};
            }

            if (!groups[groupKey][outputLine]) {
                groups[groupKey][outputLine] = 0;
            }
            groups[groupKey][outputLine]++;
        }
    }

    // Sort categories, placing (UNMAPPED/FAILED) at the very top.
    const categories = Object.keys(groups).sort((a, b) => {
        if (a === "(UNMAPPED/FAILED)") return -1;
        if (b === "(UNMAPPED/FAILED)") return 1;
        return a.localeCompare(b);
    });

    const parsedPath = path.parse(logPath);
    const outputPath = path.join(parsedPath.dir, `grouped-${parsedPath.name}.txt`);
    const outStream = fs.createWriteStream(outputPath);

    outStream.write(`# Grouped Mapping Summary\n`);
    outStream.write(`# Processed ${totalLines} mapping events.\n\n`);

    for (const category of categories) {
        outStream.write(`📋 ${category}\n`);
        const entries = groups[category];
        
        // Sort inside category by frequency descending
        const sortedEntries = Object.entries(entries).sort((a, b) => b[1] - a[1]);
        
        for (const [entryStr, count] of sortedEntries) {
            outStream.write(`   ${count}x ${entryStr}\n`);
        }
        outStream.write(`\n`);
    }

    outStream.end();
    console.log(`Successfully grouped ${totalLines} mapping events! output written to: ${outputPath}`);
}

run();
