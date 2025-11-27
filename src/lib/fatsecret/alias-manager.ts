import { prisma } from '../db';
import { debugLogger } from './debug-logger';

/**
 * Creates an alias for a FatSecret food if it doesn't already exist.
 * This allows future searches for the same term to find this food immediately.
 * 
 * @param foodId The FatSecret food ID
 * @param alias The alias string (e.g. "ketchup" or "tomato ketchup")
 * @param source The source of this alias ('auto-map', 'user', 'import')
 */
export async function createFoodAlias(
    foodId: string,
    alias: string,
    source: 'auto-map' | 'user' | 'import' = 'auto-map'
): Promise<void> {
    if (!foodId || !alias) return;

    const normalizedAlias = alias.toLowerCase().trim();

    // Don't create aliases for very short strings or numbers
    if (normalizedAlias.length < 3 || /^\d+$/.test(normalizedAlias)) return;

    try {
        // Check if alias already exists for this food
        const existing = await prisma.fatSecretFoodAlias.findUnique({
            where: {
                foodId_alias: {
                    foodId,
                    alias: normalizedAlias
                }
            }
        });

        if (!existing) {
            await prisma.fatSecretFoodAlias.create({
                data: {
                    foodId,
                    alias: normalizedAlias,
                    source,
                    locale: 'en'
                }
            });

            debugLogger.logDebug(`Created alias "${normalizedAlias}" for food ${foodId}`, {
                type: 'alias_created',
                foodId,
                alias: normalizedAlias,
                source
            });
        }
    } catch (error) {
        // Ignore unique constraint violations or other errors to prevent blocking the main flow
        debugLogger.logDebug(`Failed to create alias "${normalizedAlias}"`, {
            type: 'alias_creation_failed',
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
