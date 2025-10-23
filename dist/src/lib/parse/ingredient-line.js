"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseIngredientLine = parseIngredientLine;
const quantity_1 = require("./quantity");
const unit_1 = require("./unit");
function parseIngredientLine(line) {
    if (!line || line.trim().length === 0)
        return null;
    // Tokenize the line
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0)
        return null;
    let i = 0;
    // Parse quantity
    const qtyResult = (0, quantity_1.parseQuantityTokens)(tokens.slice(i));
    if (!qtyResult)
        return null;
    const qty = qtyResult.qty;
    i += qtyResult.consumed;
    // Parse unit and multiplier
    let unit = null;
    let rawUnit = null;
    let multiplier = 1;
    // Check first token for multiplier or unit
    if (i < tokens.length) {
        const firstToken = tokens[i];
        const firstNormalized = (0, unit_1.normalizeUnitToken)(firstToken);
        if (firstNormalized.kind === 'multiplier') {
            multiplier *= firstNormalized.factor;
            i++;
            // Look for unit in next tokens (up to 2 more tokens)
            for (let j = 0; j < 2 && i + j < tokens.length; j++) {
                const token = tokens[i + j];
                const normalized = (0, unit_1.normalizeUnitToken)(token);
                if (normalized.kind === 'mass' || normalized.kind === 'volume' || normalized.kind === 'count') {
                    unit = normalized.unit;
                    rawUnit = token;
                    // Only consume the unit token if it's not the last token (to preserve compound names)
                    if (i + j + 1 < tokens.length) {
                        i = i + j + 1;
                    }
                    break;
                }
            }
        }
        else if (firstNormalized.kind === 'mass' || firstNormalized.kind === 'volume' || firstNormalized.kind === 'count') {
            unit = firstNormalized.unit;
            rawUnit = firstToken;
            // Only consume the unit token if it's not the last token (to preserve compound names)
            if (i + 1 < tokens.length) {
                i++;
            }
        }
        else if (firstNormalized.kind === 'unknown') {
            rawUnit = firstToken;
            i++;
        }
    }
    // Remaining tokens are the name
    const name = tokens.slice(i).join(' ').trim();
    if (!name)
        return null;
    return {
        qty,
        multiplier,
        unit: unit || null,
        rawUnit: rawUnit || null,
        name,
        notes: null
    };
}
