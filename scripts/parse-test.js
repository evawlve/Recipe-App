const fs = require('fs');
const txt = fs.readFileSync('scripts/test-verbose.txt', 'utf16le');
const lines = txt.split('\n');
let capture = false;
const out = [];

for (const line of lines) {
  if (line.includes('FAIL ')) {
    out.push(line);
  } else if (line.trim().startsWith('●')) {
    capture = true;
    out.push(line);
  } else if (capture && line.trim() === '') {
    capture = false;
  } else if (capture) {
    out.push(line);
  }
}
fs.writeFileSync('scripts/parsed-test.txt', out.join('\n'));
