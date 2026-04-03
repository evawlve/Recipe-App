import fs from 'fs';
import path from 'path';
const p = path.resolve(process.cwd(), 'data/fatsecret/normalization-rules.json');
const rules = JSON.parse(fs.readFileSync(p, 'utf8'));
const found = rules.synonym_rewrites.find(x => x.from.includes('sour cream') || x.to.includes('regular sour cream'));
console.log('FROM JSON FILE:', found);
