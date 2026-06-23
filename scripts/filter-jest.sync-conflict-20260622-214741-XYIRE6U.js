const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
let capture = false;
rl.on('line', line => {
  if (line.includes('FAIL ')) console.log(line);
  if (line.trim().startsWith('●')) { capture = true; console.log(line); }
  else if (capture && line.trim() === '') capture = false;
  else if (capture) console.log(line);
});
