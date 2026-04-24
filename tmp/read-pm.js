const fs = require('fs');
const content = fs.readFileSync('tmp/pm.txt', 'utf16le');
// Find lines matching JSON outputs or interesting debug things
const lines = content.split('\n');
const relevant = lines.filter(l => l.includes('Pancake Mix') || l.includes('Complete') || l.includes('RESULT') || l.includes('level":'));
fs.writeFileSync('tmp/pm-clean.txt', relevant.join('\n'));
