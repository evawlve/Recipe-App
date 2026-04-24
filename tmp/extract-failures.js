const fs = require('fs');
const text = fs.readFileSync('C:\\Dev\\Recipe App\\logs\\mapping-summary-2026-03-30T05-16-39.txt', 'utf8');
const lines = text.split('\n');
const failures = lines.filter(l => l.includes('✗') || l.includes('[LOW_CONF]') || l.includes('[COMPLEX_PRODUCT]'));
fs.writeFileSync('C:\\Dev\\Recipe App\\tmp\\failed.txt', failures.join('\n'));
