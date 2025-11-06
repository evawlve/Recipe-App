/*
  FDC API client with in-memory LRU cache and token-bucket style rate limiting.
  - Honors env vars: FDC_API_KEY, FDC_RATE_LIMIT_PER_HOUR (default 1000), ENABLE_BRANDED_SEARCH
  - Public API: fdcApi.searchFoods({ query, pageSize })
*/

type FdcSearchParams = {
  query: string;
  pageSize?: number;
};

type FdcSearchResponse = {
  foods: Array<{
    fdcId: number;
    description: string;
    brandName?: string;
    gtinUpc?: string;
    dataType?: string; // Branded | Foundation | SR Legacy | Survey (FNDDS)
  }>;
  totalHits?: number;
  currentPage?: number;
  totalPages?: number;
};

const FDC_BASE_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

// Simple in-memory LRU cache with TTL
class LruTtlCache<K, V> {
  private map = new Map<K, { value: V; expiresAt: number }>();
  constructor(private capacity: number, private ttlMs: number) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    const expiresAt = Date.now() + this.ttlMs;
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt });
    if (this.map.size > this.capacity) {
      // delete least-recently-used (first inserted)
      const firstKey = this.map.keys().next().value as K | undefined;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
  }
}

// Token bucket limiter (per-second burst derived from per-hour limit)
class TokenBucketLimiter {
  private tokens: number;
  private lastRefill: number;
  constructor(private maxPerSecond: number) {
    this.tokens = maxPerSecond;
    this.lastRefill = Date.now();
  }
  async take(): Promise<void> {
    // Refill based on elapsed time
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs > 0) {
      const refill = Math.floor((elapsedMs / 1000) * this.maxPerSecond);
      if (refill > 0) {
        this.tokens = Math.min(this.maxPerSecond, this.tokens + refill);
        this.lastRefill = now;
      }
    }
    // Wait until a token is available
    while (this.tokens <= 0) {
      await new Promise((r) => setTimeout(r, 50));
      const now2 = Date.now();
      const elapsed2 = now2 - this.lastRefill;
      const refill2 = Math.floor((elapsed2 / 1000) * this.maxPerSecond);
      if (refill2 > 0) {
        this.tokens = Math.min(this.maxPerSecond, this.tokens + refill2);
        this.lastRefill = now2;
      }
    }
    this.tokens -= 1;
  }
}

class FdcApiClient {
  private apiKey: string | undefined;
  private enableBrandedSearch: boolean;
  private limiter: TokenBucketLimiter;
  private cache: LruTtlCache<string, FdcSearchResponse>;

  constructor() {
    this.apiKey = process.env.FDC_API_KEY;
    const perHour = Number(process.env.FDC_RATE_LIMIT_PER_HOUR || '1000');
    const perSecond = Math.max(1, Math.floor(perHour / 3600));
    this.enableBrandedSearch = (process.env.ENABLE_BRANDED_SEARCH || 'false') === 'true';
    this.limiter = new TokenBucketLimiter(Math.min(10, perSecond)); // hard-cap 10 rps safety
    // 200 entries, 24h TTL
    this.cache = new LruTtlCache<string, FdcSearchResponse>(200, 24 * 60 * 60 * 1000);
  }

  private buildCacheKey(params: FdcSearchParams): string {
    return `${params.query}:${params.pageSize || 10}`;
  }

  async searchFoods(params: FdcSearchParams): Promise<FdcSearchResponse | null> {
    if (!this.apiKey) {
      console.warn('FDC_API_KEY missing; FDC search disabled');
      return null;
    }

    const pageSize = Math.max(1, Math.min(50, params.pageSize ?? 10));
    const cacheKey = this.buildCacheKey({ query: params.query, pageSize });

    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    await this.limiter.take();

    const dataTypes = this.enableBrandedSearch ? 'Branded' : 'Branded,Foundation,SR%20Legacy';

    const url = `${FDC_BASE_URL}?api_key=${this.apiKey}&query=${encodeURIComponent(
      params.query
    )}&pageSize=${pageSize}&dataType=${dataTypes}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      console.error('FDC API error', res.status, res.statusText);
      return null;
    }

    const json = (await res.json()) as FdcSearchResponse;
    // Basic shape guard
    if (!json || !Array.isArray(json.foods)) {
      return null;
    }

    this.cache.set(cacheKey, json);
    return json;
  }
}

export const fdcApi = new FdcApiClient();


