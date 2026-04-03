import fs from 'fs'; 
const txt = fs.readFileSync('tmp/debug-oats.txt', 'utf16le'); 
const start = txt.indexOf('INGREDIENT: "1 cube beef bouillon"'); 
let end = txt.indexOf('INGREDIENT: "1 cup quick oats"', start + 1); 
if (end === -1) end = txt.length; 
fs.writeFileSync('tmp/debug-oats-b.txt', txt.substring(start, end), 'utf8');
