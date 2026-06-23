#!/usr/bin/env ts-node

import fs from 'fs';
import { CuratedPackSchema } from '@/ops/curated/seed-schema';

function canonical(s:string){ return s.toLowerCase().replace(/\(.*?\)/g,'').replace(/[,.-]/g,' ').replace(/\s+/g,' ').trim(); }

(async () => {
  const file = process.argv[2] || 'data/curated/pack-basic.json';
  const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  const pack = CuratedPackSchema.parse(raw);

  const seen = new Map<string, string[]>();
  const issues: string[] = [];

  for (const it of pack.items) {
    const key = canonical(it.name);
    const arr = seen.get(key) || [];
    arr.push(it.id);
    seen.set(key, arr);

    if (it.kcal100 === 0 && it.protein100 === 0 && it.carbs100 === 0 && it.fat100 === 0) {
      issues.push(`ZERO MACROS: ${it.id} "${it.name}"`);
    }
    if (!it.units?.length) {
      issues.push(`NO UNITS: ${it.id} "${it.name}"`);
    }
    if (it.kcal100 > 1200 || it.kcal100 < 0) {
      issues.push(`IMPLAUSIBLE KCAL: ${it.id} "${it.name}" → ${it.kcal100}`);
    }
  }

  for (const [k, ids] of seen) {
    if (ids.length > 1) issues.push(`POSSIBLE DUPE name="${k}" ids=${ids.join(',')}`);
  }

  if (issues.length) {
    console.log('Lint issues:\n' + issues.map(i => ' - ' + i).join('\n'));
    process.exitCode = 1;
  } else {
    console.log('No lint issues.');
  }
})();
