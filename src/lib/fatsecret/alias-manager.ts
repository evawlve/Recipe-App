/**
 * Creates an alias for a food. (Mocked/Deprecated in consolidated schema)
 */
export async function createFoodAlias(
    foodId: string,
    alias: string,
    source: 'auto-map' | 'user' | 'import' = 'auto-map'
): Promise<void> {
    // No-op
}
