import fs from 'fs'; 
const txt = fs.readFileSync('tmp/debug-oats.txt', 'utf16le'); 
const start = txt.indexOf('INGREDIENT: "1 cube beef bouillon"'); 
let end = txt.indexOf('INGREDIENT: "1 cup quick oats"', start + 1); 
if (end === -1) end = txt.length; 
const lines = txt.substring(start, end).split('\n'); 
console.log(lines.filter(l => l.includes('MAPPING:') || l.includes('Result:') || l.includes('Grams:') || l.includes('Serving:') || l.includes('Selected:') || l.includes('No result')).join('\n'));
