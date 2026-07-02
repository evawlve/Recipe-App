/**
 * Helper function to detect cooking state in a text string
 * Returns 'raw', 'cooked', or null if unclear
 */
function detectCookState(text: string): 'raw' | 'cooked' | null {
    if (!text) return null;

    const lowerText = text.toLowerCase();

    // Raw indicators
    if (/\b(raw|uncooked|fresh)\b/i.test(lowerText)) {
        return 'raw';
    }

    // Cooked indicators
    if (/\b(cooked|baked|grilled|fried|roasted|boiled|steamed|sauteed|sautéed|braised|broiled)\b/i.test(lowerText)) {
        return 'cooked';
    }

    return null;
}

export { detectCookState };
