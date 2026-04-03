const fs = require('fs');
const content = fs.readFileSync('C:\\Dev\\Recipe App\\logs\\debug-protein-powder.txt', 'utf16le');
fs.writeFileSync('C:\\Dev\\Recipe App\\logs\\debug-protein-powder-utf8.txt', content, 'utf8');
