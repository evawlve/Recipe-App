"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGramsAdapter = resolveGramsAdapter;
const resolve_grams_1 = require("./resolve-grams");
const unit_graph_1 = require("../units/unit-graph");
const density_1 = require("../units/density");
const logger_1 = require("../logger");
function resolveGramsAdapter(input) {
    const { parsed, amount, densityGml, servingOptions = [] } = input;
    // If parsed present and parsed.unit is mass/volume → call existing grams logic
    if (parsed && parsed.unit && (parsed.unit === 'g' || parsed.unit === 'oz' || parsed.unit === 'lb' ||
        parsed.unit === 'ml' || parsed.unit === 'tsp' || parsed.unit === 'tbsp' || parsed.unit === 'cup' || parsed.unit === 'floz')) {
        const qtyEff = parsed.qty * parsed.multiplier;
        const density = (0, density_1.resolveDensityGml)(densityGml, null);
        try {
            if (parsed.unit === 'g' || parsed.unit === 'oz' || parsed.unit === 'lb') {
                // Mass units - direct conversion
                const massGrams = {
                    'g': 1,
                    'oz': 28.349523125,
                    'lb': 453.59237
                };
                return qtyEff * massGrams[parsed.unit];
            }
            else {
                // Volume units - use density
                return (0, unit_graph_1.gramsFromVolume)(qtyEff, parsed.unit, density);
            }
        }
        catch (error) {
            logger_1.logger.info('mapping_v2', {
                feature: 'mapping_v2',
                step: 'grams_adapter_null',
                ingredient: parsed.name,
                error: 'conversion_failed'
            });
            return null;
        }
    }
    // If parsed present and count/unknown → call resolveGramsFromParsed
    if (parsed) {
        const result = (0, resolve_grams_1.resolveGramsFromParsed)(parsed, servingOptions);
        if (result === null) {
            logger_1.logger.info('mapping_v2', {
                feature: 'mapping_v2',
                step: 'grams_adapter_fallback',
                reason: 'no_count_match',
                ingredient: parsed.name
            });
        }
        return result;
    }
    // If no parsed but amount provided → convert via existing grams logic
    if (amount && amount.unit) {
        const density = (0, density_1.resolveDensityGml)(densityGml, null);
        try {
            if (amount.unit === 'g' || amount.unit === 'oz' || amount.unit === 'lb') {
                // Mass units - direct conversion
                const massGrams = {
                    'g': 1,
                    'oz': 28.349523125,
                    'lb': 453.59237
                };
                return amount.qty * massGrams[amount.unit];
            }
            else {
                // Volume units - use density
                return (0, unit_graph_1.gramsFromVolume)(amount.qty, amount.unit, density);
            }
        }
        catch (error) {
            logger_1.logger.info('mapping_v2', {
                feature: 'mapping_v2',
                step: 'grams_adapter_null',
                ingredient: 'amount_input',
                error: 'conversion_failed'
            });
            return null;
        }
    }
    // Otherwise return null
    logger_1.logger.info('mapping_v2', {
        feature: 'mapping_v2',
        step: 'grams_adapter_null',
        ingredient: 'no_valid_input'
    });
    return null;
}
