const fs = require('fs');
const file = 'C:/Dev/Recipe App/src/lib/fatsecret/map-ingredient-with-fallback.ts';
let content = fs.readFileSync(file, 'utf-8');

// The bad line contains literal \r\n sequences that need to become actual newlines
// Find the line starting with "    let finalGrams" that contains the mangled content
const lines = content.split('\n');
const badLineIdx = lines.findIndex(l => l.includes('let finalGrams') && l.includes('MINI MODIFIER OVERRIDE'));

if (badLineIdx >= 0) {
    console.log(`Found bad line at index ${badLineIdx}`);
    // Replace literal \\r\\n with actual \r\n
    let fixed = lines[badLineIdx]
        .replace(/\\r\\n/g, '\r\n');
    // Also fix double-escaped regex: \\\\b -> \\b and \\\\s -> \\s
    fixed = fixed.replace(/\\\\b/g, '\\b').replace(/\\\\s/g, '\\s');
    
    // Replace the single bad line with the expanded content
    lines[badLineIdx] = fixed;
    const newContent = lines.join('\n');
    fs.writeFileSync(file, newContent, 'utf-8');
    console.log('Fixed! New line count:', newContent.split('\n').length);
} else {
    console.log('Bad line not found');
}
