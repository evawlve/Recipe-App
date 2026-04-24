const fs = require('fs');
const files = fs.readdirSync('logs').filter(f => f.startsWith('mapping-summary')).sort();
const file = files[files.length - 1];
const text = fs.readFileSync('logs/' + file, 'utf-8');
const lines = text.split('\n');
const anomalies = lines.filter(l => 
    l.includes('✗') || 
    l.includes('MISSING_FAT_MOD') || 
    l.includes('UNWANTED_FAT_MOD') || 
    l.includes('HIGH_KCAL') ||
    l.includes('LOW_CONF')
);
fs.writeFileSync('tmp/anomalies.txt', anomalies.join('\n'));
console.log('Anomalies found in ' + file + ': ' + anomalies.length);
