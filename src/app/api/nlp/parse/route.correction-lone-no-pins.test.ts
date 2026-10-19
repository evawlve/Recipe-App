/**
 * /api/nlp/parse - the ten lone-`no` repros pinned at the route.
 *
 * S240 (seat C69). Same harness as route.correction-lone-no.test.ts: the mapper is mocked and records every
 * rawText it is called with; each line runs on the SegmentationCache-hit AND the fresh-LLM path.
 */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { SEG_PARSER_VERSION } from "@/lib/nlp/ai-segmenter";

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock("@/lib/db", () => ({
  prisma: {
    nlpRequestLog: {
      count: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(async () => ({ count: 0 })),
    },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock("@/lib/ai/structured-client", () => ({
  callStructuredLlm: jest.fn(),
}));

jest.mock("@/lib/mapping/ai-nutrition-backfill", () => ({
  ...jest.requireActual("@/lib/mapping/ai-nutrition-backfill"),
  requestAiNutrition: jest.fn(),
}));

jest.mock("@/lib/mapping/map-ingredient-with-fallback", () => ({
  mapIngredientWithFallback: jest.fn(async (rawText: string) => {
    const {
      requestAiNutrition,
    } = require("@/lib/mapping/ai-nutrition-backfill");
    await requestAiNutrition(rawText);
    return { status: "no_match" };
  }),
}));

jest.mock("@/lib/nlp/resolve-payload", () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = {
  rawText: string;
  mealType: string;
  brand: string;
  normalizedForm: string;
};
const seg = (rawText: string, normalizedForm = ""): Seg => ({
  rawText,
  mealType: "lunch",
  brand: "",
  normalizedForm,
});

const LINES: Array<{
  text: string;
  split: Seg[];
  expected: string[];
  title?: string;
}> = [
  {
    text: "pizza, no anchovies",
    split: [seg("pizza", "pizza"), seg("anchovies", "anchovies")],
    expected: ["pizza", "anchovies"],
  },
  {
    text: "a pizza, no anchovies",
    split: [seg("a pizza", "pizza"), seg("anchovies", "anchovies")],
    expected: ["a pizza", "anchovies"],
  },
  {
    text: "chicken burrito, no sour cream or cheese",
    split: [
      seg("chicken burrito", "chicken burrito"),
      seg("sour cream", "sour cream"),
      seg("cheese", "cheese"),
    ],
    expected: ["chicken burrito", "sour cream", "cheese"],
  },
  {
    text: "ramen, no egg",
    split: [seg("ramen", "ramen"), seg("egg", "egg")],
    expected: ["ramen", "egg"],
  },
  {
    text: "ramen no egg",
    split: [seg("ramen", "ramen"), seg("egg", "egg")],
    expected: ["ramen no egg"],
    title:
      "`ramen no egg` (<=6 words, no separator) stays ONE item via singleItemFromText() and never reaches the swap",
  },
  {
    text: "a coffee, no, a tea",
    split: [seg("a coffee", "coffee"), seg("a tea", "tea")],
    expected: ["a tea"],
  },
  {
    text: "coffee, no, tea",
    split: [seg("coffee", "coffee"), seg("tea", "tea")],
    expected: ["tea"],
  },
  {
    text: "two eggs, no, three eggs",
    split: [seg("two eggs", "eggs"), seg("three eggs", "eggs")],
    expected: ["3 eggs"],
  },
  {
    text: "a burger, no bun",
    split: [seg("a burger", "burger"), seg("bun", "bun")],
    expected: ["a burger", "bun"],
  },
  {
    text: "a latte, no wait, a cappuccino",
    split: [seg("a latte", "latte"), seg("a cappuccino", "cappuccino")],
    expected: ["a cappuccino"],
  },
];

function parseRequest(body: object): NextRequest {
  return new NextRequest("http://localhost:3000/api/nlp/parse", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": "adminAPI_dev_key_bypass",
    },
    body: JSON.stringify(body),
  });
}

describe("/api/nlp/parse lone no pins", () => {
  const { prisma } = require("@/lib/db");
  const { callStructuredLlm } = require("@/lib/ai/structured-client");
  const { requestAiNutrition } = require("@/lib/mapping/ai-nutrition-backfill");
  const {
    mapIngredientWithFallback,
  } = require("@/lib/mapping/map-ingredient-with-fallback");
  const { logger } = require("@/lib/logger");
  let spies: jest.SpyInstance[] = [];

  const aiCalls = (): string[] =>
    requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: "success",
      content: { items },
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
    });
  const cacheHit = (text: string, items: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: text,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: items,
      hitCount: 3,
    });

  beforeAll(() => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/test";
    process.env.DEV_API_KEY = "adminAPI_dev_key_bypass";
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    spies = [
      jest.spyOn(logger, "info").mockImplementation(() => undefined),
      jest.spyOn(console, "log").mockImplementation(() => undefined),
      jest.spyOn(console, "warn").mockImplementation(() => undefined),
    ];
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  describe.each([
    ["SegmentationCache HIT", true],
    ["fresh LLM", false],
  ] as const)("%s", (_label, hit) => {
    test.each(
      LINES.map((l) => ({
        ...l,
        name:
          l.title ??
          `\`${l.text}\` reaches the mapper as ${JSON.stringify(l.expected)}`,
      })),
    )("$name", async ({ text, split, expected }) => {
      if (hit) cacheHit(text, split);
      else llmReturns(split);
      const response = await POST(parseRequest({ text }));
      expect(response.status).toBe(200);
      if (hit) expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(expected.length);
      expect(aiCalls()).toEqual(expected);
    });
  });
});
