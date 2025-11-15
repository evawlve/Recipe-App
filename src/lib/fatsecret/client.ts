import { logger } from '../logger';
import {
  FATSECRET_CLIENT_ID,
  FATSECRET_CLIENT_SECRET,
  FATSECRET_REGION,
  FATSECRET_SCOPE,
  FATSECRET_BARCODE_REGION,
  FATSECRET_TIMEOUT_MS,
} from './config';

const DEFAULT_BASE_URL = 'https://platform.fatsecret.com/rest/server.api';
const DEFAULT_OAUTH_URL = 'https://oauth.fatsecret.com/connect/token';

export type FatSecretFoodType = 'Generic' | 'Brand' | string;

export interface FatSecretServing {
  id?: string | null;
  description?: string | null;
  metricServingAmount?: number | null;
  metricServingUnit?: string | null;
  numberOfUnits?: number | null;
  measurementDescription?: string | null;
  servingWeightGrams?: number | null;
  calories?: number | null;
  carbohydrate?: number | null;
  protein?: number | null;
  fat?: number | null;
  saturatedFat?: number | null;
  polyunsaturatedFat?: number | null;
  monounsaturatedFat?: number | null;
  transFat?: number | null;
  cholesterol?: number | null;
  sodium?: number | null;
  potassium?: number | null;
  fiber?: number | null;
  sugar?: number | null;
}

export interface FatSecretFoodSummary {
  id: string;
  name: string;
  brandName?: string | null;
  foodType?: FatSecretFoodType;
  description?: string | null;
  country?: string | null;
  servings?: FatSecretServing[];
}

export interface FatSecretFoodDetails extends FatSecretFoodSummary {
  servings: FatSecretServing[];
}

export interface FatSecretSearchResponse {
  foods: FatSecretFoodSummary[];
  totalResults: number;
  maxResults: number;
  pageNumber: number;
}

export interface FatSecretNlpFoodEntry {
  foodId: string;
  foodName: string;
  brandName?: string | null;
  servingId?: string | null;
  servingDescription?: string | null;
  servingWeightGrams?: number | null;
  servings?: FatSecretServing[];
}

export interface FatSecretNlpParseResponse {
  entries: FatSecretNlpFoodEntry[];
}

export interface FatSecretClientOptions {
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  oauthUrl?: string;
}

export interface FatSecretSearchOptions {
  maxResults?: number;
  pageNumber?: number;
}

export class FatSecretError extends Error {
  constructor(message: string, public status?: number, public responseBody?: any) {
    super(message);
    this.name = 'FatSecretError';
  }
}

export class FatSecretAuthError extends FatSecretError {
  constructor(message: string, status?: number, responseBody?: any) {
    super(message, status, responseBody);
    this.name = 'FatSecretAuthError';
  }
}

export class FatSecretRateLimitError extends FatSecretError {
  constructor(message: string, status?: number, responseBody?: any) {
    super(message, status, responseBody);
    this.name = 'FatSecretRateLimitError';
  }
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export class FatSecretClient {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly oauthUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(options: FatSecretClientOptions = {}) {
    this.clientId = options.clientId ?? FATSECRET_CLIENT_ID;
    this.clientSecret = options.clientSecret ?? FATSECRET_CLIENT_SECRET;
    this.timeoutMs = options.timeoutMs ?? FATSECRET_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.oauthUrl = options.oauthUrl ?? DEFAULT_OAUTH_URL;
  }

  async searchFoods(query: string, opts: FatSecretSearchOptions = {}): Promise<FatSecretSearchResponse> {
    const response = await this.request<any>({
      method: 'foods.search.v4',
      search_expression: query,
      max_results: String(opts.maxResults ?? 8),
      page_number: String(opts.pageNumber ?? 0),
    });

    const foods = normalizeFoods(response?.foods?.food);
    return {
      foods,
      totalResults: Number(response?.foods?.total_results ?? foods.length),
      maxResults: Number(response?.foods?.max_results ?? foods.length),
      pageNumber: Number(response?.foods?.page_number ?? 0),
    };
  }

  async searchFoodsV4(query: string, opts: FatSecretSearchOptions = {}): Promise<FatSecretFoodSummary[]> {
    const response = await this.request<any>({
      method: 'foods.search.v4',
      search_expression: query,
      max_results: String(opts.maxResults ?? 8),
      page_number: String(opts.pageNumber ?? 0),
    });

    const foodsNode =
      response?.foods_search?.results?.food ??
      response?.foods_search?.food ??
      response?.foods?.food ??
      null;

    return normalizeFoods(foodsNode);
  }

  async getFood(foodId: string): Promise<FatSecretFoodDetails | null> {
    if (!foodId) return null;
    const response = await this.request<any>({
      method: 'food.get.v4',
      food_id: foodId,
    });
    const food = response?.food;
    if (!food) return null;
    return normalizeFoodDetails(food);
  }

  async getFoodDetails(foodId: string): Promise<FatSecretFoodDetails | null> {
    return this.getFood(foodId);
  }

  async getFoodById(foodId: string): Promise<FatSecretFoodDetails | null> {
    return this.getFood(foodId);
  }

  async getFoodByBarcode(barcode: string): Promise<FatSecretFoodDetails | null> {
    if (!barcode) return null;
    try {
      const response = await this.request<any>({
        method: 'food.find_id_for_barcode',
        barcode,
        region: FATSECRET_BARCODE_REGION,
      });

      const rawFoodId =
        response?.food_id ??
        response?.food?.food_id ??
        (Array.isArray(response?.foods?.food)
          ? response.foods.food[0]?.food_id
          : response?.foods?.food?.food_id) ??
        null;

      const foodIdValue =
        typeof rawFoodId === 'object' && rawFoodId !== null && 'value' in rawFoodId
          ? rawFoodId.value
          : rawFoodId;

      const foodIdStr = String(foodIdValue ?? '').trim();
      if (!foodIdStr) {
        return null;
      }

      try {
        return await this.getFood(foodIdStr);
      } catch (getFoodErr) {
        // Catch errors from getFood (e.g., invalid food_id) and return null
        if (getFoodErr instanceof FatSecretError) {
          if (getFoodErr.status === 404 || getFoodErr.message?.includes('Invalid long value')) {
            return null;
          }
        }
        throw getFoodErr;
      }
    } catch (err) {
      if (err instanceof FatSecretError && err.status === 404) {
        return null;
      }
      // Also catch invalid food_id errors and return null
      if (err instanceof FatSecretError && (err.message?.includes('Invalid long value') || err.message?.includes('Invalid'))) {
        return null;
      }
      throw err;
    }
  }

  async nlpParse(text: string): Promise<FatSecretNlpParseResponse | null> {
    if (!text.trim()) return null;
    try {
      const response = await this.request<any>({
        method: 'food_entries.parse.v2',
        text,
      });
      const entriesRaw = response?.food_entries?.food_entry;
      if (!entriesRaw) return null;
      const entries = normalizeNlpEntries(entriesRaw);
      return { entries };
    } catch (err) {
      if (err instanceof FatSecretError && err.status === 404) {
        return null;
      }
      if (err instanceof FatSecretRateLimitError) {
        throw err;
      }
      logger.warn('fatsecret.nlp_parse_failed', { error: (err as Error).message });
      return null;
    }
  }

  private async request<T>(params: Record<string, string>): Promise<T> {
    if (!this.clientId || !this.clientSecret) {
      throw new FatSecretAuthError('Missing FatSecret client credentials');
    }

    // Build params: default region can be overridden by params.region
    const queryParams: Record<string, string> = {
      format: 'json',
      region: FATSECRET_REGION,
      ...params,
    };
    const query = new URLSearchParams(queryParams);

    const token = await this.getAccessToken();

    const url = `${this.baseUrl}?${query.toString()}`;
    let response = await this.fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 401) {
      this.token = null;
      const retryToken = await this.getAccessToken(true);
      response = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${retryToken}`,
        },
      });
    }

    if (response.status === 429) {
      throw new FatSecretRateLimitError('FatSecret rate limit exceeded', response.status, await safeJson(response));
    }

    if (!response.ok) {
      throw new FatSecretError(`FatSecret request failed (${response.status})`, response.status, await safeJson(response));
    }

    const payload = await response.json();

    if ((payload as any)?.error) {
      const err = (payload as any).error;

      throw new FatSecretError(
        `FatSecret error ${err.code ?? ''}: ${err.message ?? 'unknown'}`,
        response.status,
        payload
      );
    }

    return payload as T;
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.token.expiresAt > Date.now() + 5000) {
      return this.token.value;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: FATSECRET_SCOPE,
    });

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    const response = await this.fetchWithTimeout(this.oauthUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new FatSecretAuthError(`Failed to obtain FatSecret token (${response.status})`, response.status, await safeJson(response));
    }

    const data = (await response.json()) as OAuthTokenResponse;
    const expiresInMs = Math.max(30_000, data.expires_in * 1000);
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + expiresInMs,
    };

    return data.access_token;
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeFoods(raw: any): FatSecretFoodSummary[] {
  if (!raw) return [];
  const foodsArray = Array.isArray(raw) ? raw : [raw];
  return foodsArray
    .map(normalizeFoodSummary)
    .filter((food): food is FatSecretFoodSummary => Boolean(food));
}

function normalizeFoodSummary(raw: any): FatSecretFoodSummary | null {
  if (!raw || !raw.food_id || !raw.food_name) return null;
  return {
    id: String(raw.food_id),
    name: String(raw.food_name),
    brandName: raw.brand_name ?? null,
    foodType: raw.food_type ?? undefined,
    description: raw.food_description ?? null,
    country: raw.country ?? null,
    servings: normalizeServings(raw.servings?.serving),
  };
}

function normalizeFoodDetails(raw: any): FatSecretFoodDetails {
  return {
    id: String(raw.food_id),
    name: String(raw.food_name),
    brandName: raw.brand_name ?? null,
    foodType: raw.food_type ?? undefined,
    description: raw.food_description ?? null,
    country: raw.country ?? null,
    servings: normalizeServings(raw.servings?.serving),
  };
}

function normalizeServings(raw: any): FatSecretServing[] {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((serving: any) => ({
    id: serving.serving_id ? String(serving.serving_id) : null,
    description: serving.serving_description ?? serving.measurement_description ?? null,
    metricServingAmount: parseNumber(serving.metric_serving_amount),
    metricServingUnit: serving.metric_serving_unit ?? null,
    numberOfUnits: parseNumber(serving.number_of_units),
    measurementDescription: serving.measurement_description ?? null,
    servingWeightGrams: parseNumber(serving.serving_weight_grams),
    calories: parseNumber(serving.calories),
    carbohydrate: parseNumber(serving.carbohydrate),
    protein: parseNumber(serving.protein),
    fat: parseNumber(serving.fat),
    saturatedFat: parseNumber(serving.saturated_fat),
    polyunsaturatedFat: parseNumber(serving.polyunsaturated_fat),
    monounsaturatedFat: parseNumber(serving.monounsaturated_fat),
    transFat: parseNumber(serving.trans_fat),
    cholesterol: parseNumber(serving.cholesterol),
    sodium: parseNumber(serving.sodium),
    potassium: parseNumber(serving.potassium),
    fiber: parseNumber(serving.fiber),
    sugar: parseNumber(serving.sugar),
  }));
}

function normalizeNlpEntries(raw: any): FatSecretNlpFoodEntry[] {
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((entry: any) => ({
      foodId: entry.food_id ? String(entry.food_id) : '',
      foodName: entry.food_name ?? entry.food_entry_description ?? '',
      brandName: entry.brand_name ?? null,
      servingId: entry.serving_id ? String(entry.serving_id) : null,
      servingDescription: entry.serving_description ?? entry.measurement_description ?? null,
      servingWeightGrams: parseNumber(entry.serving_weight_grams ?? entry.metric_serving_amount),
      servings: normalizeServings(entry.servings?.serving ?? entry.serving),
    }))
    .filter(entry => Boolean(entry.foodId));
}

async function safeJson(response: Response) {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

function parseNumber(value: any): number | null {
  if (value == null || value === '') return null;
  const num = Number.parseFloat(value);
  return Number.isFinite(num) ? num : null;
}
