"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveServingOptions = deriveServingOptions;
const unit_graph_1 = require("./unit-graph");
const density_1 = require("./density");
function deriveServingOptions(food) {
    const opts = [];
    const density = (0, density_1.resolveDensityGml)(food.densityGml ?? undefined, food.categoryId ?? null);
    // 1) Food-specific units first (+ common variants)
    for (const u of food.units ?? []) {
        opts.push({ label: u.label, grams: u.grams });
        opts.push({ label: `½ ${u.label}`, grams: u.grams / 2 });
        opts.push({ label: `2 × ${u.label}`, grams: u.grams * 2 });
    }
    // 2) Generic mass units (always valid)
    opts.push({ label: '100 g', grams: 100 }, { label: '1 oz', grams: (0, unit_graph_1.convertMass)(1, 'oz', 'g') }, { label: '4 oz', grams: (0, unit_graph_1.convertMass)(4, 'oz', 'g') });
    // 3) Derived volumes (only if we can compute grams from ml)
    if (density > 0) {
        const gPerTbsp = (0, unit_graph_1.gramsFromVolume)(1, 'tbsp', density);
        const gPerTsp = (0, unit_graph_1.gramsFromVolume)(1, 'tsp', density);
        const gPerCup = (0, unit_graph_1.gramsFromVolume)(1, 'cup', density);
        opts.push({ label: '1 tbsp', grams: gPerTbsp }, { label: '1 tsp', grams: gPerTsp }, { label: '¼ cup', grams: gPerCup / 4 }, { label: '1 cup', grams: gPerCup });
    }
    // de-dup labels
    const seen = new Set();
    return opts.filter(o => (seen.has(o.label) ? false : (seen.add(o.label), true)));
}
