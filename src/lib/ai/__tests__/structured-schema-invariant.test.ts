/**
 * Structured-output schema invariant (OpenAI/Azure strict mode).
 *
 * Strict json_schema mode rejects any schema whose object nodes do not list
 * EVERY key of `properties` in `required`:
 *
 *   HTTP 400 "Invalid schema for response_format '<name>': In context=(),
 *   'required' is required to be supplied and to be an array including every
 *   key in properties. Missing '<key>'."
 *
 * The failure is silent in production: the structured client falls back to
 * the secondary model on every call, paying a failed round-trip in latency
 * and losing the intended primary model (this is exactly how the
 * 'ingredient_parse' schema shipped broken — `notes` was in `properties`
 * but not in `required`).
 *
 * Optional fields must instead be REQUIRED with a nullable type union
 * (e.g. type: ['string', 'null']) — never omitted from `required`.
 *
 * This test enforces the invariant mechanically for every structured-output
 * schema in the codebase, recursively (nested objects, array items,
 * anyOf/oneOf/allOf). A registry-completeness check counts `strict: true`
 * schema declarations under src/ so that adding a new schema without
 * registering it here fails the suite.
 */

// Several schema modules transitively import the Prisma client at module
// scope (via '@/lib/db'); stub it so importing them stays side-effect free.
jest.mock('@/lib/db', () => ({ prisma: {} }));
// ai-nutrition-backfill → modifier-constraints → gather-candidates calls
// warmupEmbedder() at module scope, which starts an async ONNX model load
// that leaves an open handle after the run; stub the embedding module.
jest.mock('@/lib/search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';

import { RESPONSE_SCHEMA as INGREDIENT_PARSE_SCHEMA } from '@/lib/mapping/ai-parse';
import { JSON_SCHEMA as SIMPLIFY_SCHEMA } from '@/lib/mapping/ai-simplify';
import { RESPONSE_SCHEMA as NORMALIZE_SCHEMA } from '@/lib/mapping/ai-normalize';
import { BATCH_RESPONSE_SCHEMA } from '@/lib/mapping/ai-batch-normalize';
import { RESPONSE_SCHEMA as RERANK_SCHEMA } from '@/lib/mapping/ai-rerank';
import { RESPONSE_SCHEMA as SYNONYM_SCHEMA } from '@/lib/mapping/ai-synonym-generator';
import { RESPONSE_SCHEMA as SEARCH_REFINE_SCHEMA } from '@/lib/mapping/ai-search-refine';
import { NUTRITION_RESPONSE_SCHEMA } from '@/lib/mapping/ai-nutrition-backfill';
import { VALIDATION_SCHEMA } from '@/lib/mapping/ai-validation';
import { RESPONSE_SCHEMA as SERVING_SCHEMA } from '@/lib/ai/serving-estimator';
import {
    RESPONSE_SCHEMA as AMBIGUOUS_SERVING_SCHEMA,
    PRODUCE_SIZE_RESPONSE_SCHEMA,
} from '@/lib/ai/ambiguous-serving-estimator';
import { RESPONSE_SCHEMA as SIMPLE_SERVING_SCHEMA } from '@/lib/ai/simple-serving-estimator';
import { NLP_SPLIT_SCHEMA } from '@/lib/nlp/ai-segmenter';

type StructuredSchema = {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
};

/**
 * Registry of every structured-output schema in the codebase.
 * When you add a new schema (the { name, schema, strict: true } object passed
 * as response_format json_schema / to callStructuredLlm), export it from its
 * module and add it here — the completeness check below fails otherwise.
 */
const ALL_SCHEMAS: StructuredSchema[] = [
    INGREDIENT_PARSE_SCHEMA,
    SIMPLIFY_SCHEMA,
    NORMALIZE_SCHEMA,
    BATCH_RESPONSE_SCHEMA,
    RERANK_SCHEMA,
    SYNONYM_SCHEMA,
    SEARCH_REFINE_SCHEMA,
    NUTRITION_RESPONSE_SCHEMA,
    VALIDATION_SCHEMA,
    SERVING_SCHEMA,
    AMBIGUOUS_SERVING_SCHEMA,
    PRODUCE_SIZE_RESPONSE_SCHEMA,
    SIMPLE_SERVING_SCHEMA,
    NLP_SPLIT_SCHEMA,
];

// ============================================================
// Invariant walker
// ============================================================

type Violation = { path: string; message: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nodeTypes(node: Record<string, unknown>): string[] {
    const t = node.type;
    if (typeof t === 'string') return [t];
    if (Array.isArray(t)) return t.filter((x): x is string => typeof x === 'string');
    return [];
}

/**
 * Recursively walk a JSON schema node, collecting strict-mode violations:
 * every node with `properties` must have a `required` array that includes
 * every key of `properties`.
 */
function collectViolations(node: unknown, nodePath: string, out: Violation[]): void {
    if (!isPlainObject(node)) return;

    const hasProperties = isPlainObject(node.properties);
    const isObjectNode = nodeTypes(node).includes('object') || hasProperties;

    if (isObjectNode && hasProperties) {
        const propKeys = Object.keys(node.properties as Record<string, unknown>);
        const required = node.required;
        if (!Array.isArray(required)) {
            out.push({
                path: nodePath,
                message: `'required' is missing (must be an array including every key in properties: [${propKeys.join(', ')}])`,
            });
        } else {
            const missing = propKeys.filter((k) => !required.includes(k));
            if (missing.length > 0) {
                out.push({
                    path: nodePath,
                    message: `'required' is missing key(s): ${missing.join(', ')} — optional fields must be required with a nullable type (e.g. type: ['string', 'null'])`,
                });
            }
            const unknown = required.filter((k) => !propKeys.includes(k as string));
            if (unknown.length > 0) {
                out.push({
                    path: nodePath,
                    message: `'required' lists key(s) not present in properties: ${unknown.join(', ')}`,
                });
            }
        }
    }

    // Recurse: nested object properties
    if (hasProperties) {
        for (const [key, child] of Object.entries(node.properties as Record<string, unknown>)) {
            collectViolations(child, `${nodePath}.properties.${key}`, out);
        }
    }

    // Recurse: array items (single schema or tuple form)
    if (isPlainObject(node.items)) {
        collectViolations(node.items, `${nodePath}.items`, out);
    } else if (Array.isArray(node.items)) {
        node.items.forEach((child, i) => collectViolations(child, `${nodePath}.items[${i}]`, out));
    }

    // Recurse: composition keywords
    for (const keyword of ['anyOf', 'oneOf', 'allOf'] as const) {
        const branches = node[keyword];
        if (Array.isArray(branches)) {
            branches.forEach((child, i) =>
                collectViolations(child, `${nodePath}.${keyword}[${i}]`, out));
        }
    }

    // Recurse: $defs / definitions
    for (const keyword of ['$defs', 'definitions'] as const) {
        const defs = node[keyword];
        if (isPlainObject(defs)) {
            for (const [key, child] of Object.entries(defs)) {
                collectViolations(child, `${nodePath}.${keyword}.${key}`, out);
            }
        }
    }
}

// ============================================================
// Tests
// ============================================================

describe('structured-output schemas are valid under OpenAI strict mode', () => {
    it('registry has no duplicate schema names', () => {
        const names = ALL_SCHEMAS.map((s) => s.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it.each(ALL_SCHEMAS.map((s) => [s.name, s] as const))(
        "'%s': required includes every key in properties (recursively)",
        (_name, schemaDef) => {
            expect(schemaDef.strict).toBe(true);
            expect(isPlainObject(schemaDef.schema)).toBe(true);

            const violations: Violation[] = [];
            collectViolations(schemaDef.schema, 'schema', violations);

            const report = violations
                .map((v) => `  at ${v.path}: ${v.message}`)
                .join('\n');
            expect(
                violations.length === 0
                    ? ''
                    : `Schema '${schemaDef.name}' violates strict mode:\n${report}`,
            ).toBe('');
        },
    );
});

describe('schema registry completeness', () => {
    it('every `strict: true` structured-output schema in src/ is registered in this test', () => {
        const srcRoot = path.resolve(__dirname, '../../..');
        const matches: string[] = [];

        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
                    walk(full);
                } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
                    const source = fs.readFileSync(full, 'utf8');
                    const count = (source.match(/\bstrict:\s*true\b/g) ?? []).length;
                    for (let i = 0; i < count; i++) matches.push(full);
                }
            }
        };
        walk(srcRoot);

        // One `strict: true` per schema object. If this fails because you added
        // a new structured-output schema, export it from its module and add it
        // to ALL_SCHEMAS above so the strict-mode invariant covers it.
        expect(matches.length).toBe(ALL_SCHEMAS.length);
    });
});
