"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rankCandidates = rankCandidates;
const fuse_js_1 = __importDefault(require("fuse.js"));
const plausibility_1 = require("./plausibility");
function rankCandidates(cands, opts) {
    const fuse = new fuse_js_1.default(cands.map(c => ({
        key: c.food.id,
        text: `${c.food.brand ?? ''} ${c.food.name} ${(c.aliases ?? []).join(' ')}`.trim(),
        c,
    })), { includeScore: true, threshold: 0.4, keys: ['text'] });
    const fResults = fuse.search(opts.query);
    const fuzzyScore = {};
    for (const r of fResults)
        fuzzyScore[r.item.c.food.id] = 1 - (r.score ?? 1);
    return cands.map(c => {
        const q = opts.query.toLowerCase();
        const f = c.food;
        const barcodeHit = (c.barcodes ?? []).some(b => q.replace(/\D/g, '') === b);
        const exactBrand = f.brand ? +q.includes(f.brand.toLowerCase()) : 0;
        const exactAlias = (c.aliases ?? []).some(a => a.toLowerCase() === q) ? 1 : 0;
        const fuzzy = fuzzyScore[f.id] ?? 0;
        const plaus = (0, plausibility_1.plausibilityScore)(f.kcal100, opts.kcalBand);
        const verified = f.verification === 'verified' ? 1 : f.verification === 'suspect' ? 0.2 : 0.6;
        const popularity = Math.tanh((f.popularity || 0) / 50);
        const personal = Math.tanh((c.usedByUserCount || 0) / 10);
        // Token boost for exact token matches
        const tokens = q.split(/\s+/).filter(Boolean);
        const nameTokens = `${(f.brand ?? '')} ${f.name}`.toLowerCase();
        const tokenHits = tokens.filter(t => nameTokens.includes(t)).length;
        const tokenBoost = Math.min(1, tokenHits / Math.max(1, tokens.length)); // 0..1
        const w = { barcode: 3.0, exact: 1.5, alias: 1.2, fuzzy: 2.0, plaus: 1.0, verified: 0.8, popularity: 0.7, personal: 1.0, token: 1.2 };
        const score = w.barcode * (barcodeHit ? 1 : 0) +
            w.exact * exactBrand +
            w.alias * exactAlias +
            w.fuzzy * fuzzy +
            w.plaus * plaus +
            w.verified * verified +
            w.popularity * popularity +
            w.personal * personal +
            w.token * tokenBoost;
        const confidence = Math.max(0, Math.min(1, score / 9.7));
        return { candidate: c, score, confidence };
    }).sort((a, b) => b.score - a.score);
}
