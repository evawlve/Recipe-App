#!/usr/bin/env ts-node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const seed_schema_1 = require("@/ops/curated/seed-schema");
function canonical(s) { return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[,.-]/g, ' ').replace(/\s+/g, ' ').trim(); }
(async () => {
    const file = process.argv[2] || 'data/curated/pack-basic.json';
    const raw = JSON.parse(fs_1.default.readFileSync(file, 'utf-8'));
    const pack = seed_schema_1.CuratedPackSchema.parse(raw);
    const seen = new Map();
    const issues = [];
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
        if (ids.length > 1)
            issues.push(`POSSIBLE DUPE name="${k}" ids=${ids.join(',')}`);
    }
    if (issues.length) {
        console.log('Lint issues:\n' + issues.map(i => ' - ' + i).join('\n'));
        process.exitCode = 1;
    }
    else {
        console.log('No lint issues.');
    }
})();
