const fs = require('fs');
const content = fs.readFileSync('tmp/final-verify.log', 'utf16le');
const lines = content.split('\n');
const results = lines.filter(l => !l.startsWith('{"level"') && !l.startsWith('node.exe'));
console.log(results.join('\n'));
