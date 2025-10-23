"use strict";
/**
 * Parse quantity tokens to extract numeric values and fractions
 * Handles integers, decimals, unicode fractions, and word fractions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQuantityTokens = parseQuantityTokens;
function parseQuantityTokens(tokens) {
    if (tokens.length === 0)
        return null;
    let qty = 0;
    let consumed = 0;
    let i = 0;
    // Handle unicode fractions first
    const unicodeFractions = {
        '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
        '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875
    };
    if (unicodeFractions[tokens[0]]) {
        return { qty: unicodeFractions[tokens[0]], consumed: 1 };
    }
    // Handle word fractions
    const wordFractions = {
        'half': 0.5, 'quarter': 0.25, 'third': 1 / 3
    };
    if (wordFractions[tokens[0]]) {
        return { qty: wordFractions[tokens[0]], consumed: 1 };
    }
    // Handle "one and a half" pattern
    if (tokens.length >= 4 &&
        tokens[0] === 'one' &&
        tokens[1] === 'and' &&
        tokens[2] === 'a' &&
        tokens[3] === 'half') {
        return { qty: 1.5, consumed: 4 };
    }
    // Handle "1 and 1/2" pattern
    if (tokens.length >= 3 &&
        tokens[0] === '1' &&
        tokens[1] === 'and' &&
        tokens[2] === '1/2') {
        return { qty: 1.5, consumed: 3 };
    }
    // Handle "1 1/2" pattern
    if (tokens.length >= 2 &&
        tokens[0] === '1' &&
        tokens[1] === '1/2') {
        return { qty: 1.5, consumed: 2 };
    }
    // Handle simple fractions like "1/2"
    if (tokens[0].includes('/')) {
        const parts = tokens[0].split('/');
        if (parts.length === 2) {
            const numerator = parseFloat(parts[0]);
            const denominator = parseFloat(parts[1]);
            if (!isNaN(numerator) && !isNaN(denominator) && denominator !== 0) {
                return { qty: numerator / denominator, consumed: 1 };
            }
        }
    }
    // Handle simple numbers (integers and decimals)
    const num = parseFloat(tokens[0]);
    if (!isNaN(num)) {
        qty = num;
        consumed = 1;
    }
    else {
        return null;
    }
    return { qty, consumed };
}
