/**
 * Unit tests for FDC API client
 * Tests rate limiting and caching behavior
 */

// Mock fetch globally
global.fetch = jest.fn();

// Mock environment variables
const originalEnv = process.env;

describe('FDC API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
  });

  describe('Rate Limiting', () => {
    it('should respect rate limits and not exceed 10 req/s', async () => {
      process.env.FDC_API_KEY = 'test-key';
      process.env.FDC_RATE_LIMIT_PER_HOUR = '36000'; // 10 per second
      
      // Re-import to get fresh instance with new env
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      const startTime = Date.now();
      
      // Make 15 rapid calls sequentially to test rate limiting
      for (let i = 0; i < 15; i++) {
        await fdcApi.searchFoods({ query: `test${i}`, pageSize: 1 });
      }
      
      const elapsed = Date.now() - startTime;
      
      // Should take at least 1.4 seconds (15 requests / 10 per second)
      // With tolerance for test execution time
      expect(elapsed).toBeGreaterThanOrEqual(1200);
      
      // All calls should have been made
      expect(global.fetch).toHaveBeenCalledTimes(15);
    }, 10000); // 10 second timeout for rate limiting test

    it('should handle rate limit configuration from env', async () => {
      process.env.FDC_API_KEY = 'test-key';
      process.env.FDC_RATE_LIMIT_PER_HOUR = '1800'; // 0.5 per second, but we cap at 1/sec minimum
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      const startTime = Date.now();
      
      // Make 3 calls sequentially (should take ~3 seconds at 1/sec minimum)
      await fdcApi.searchFoods({ query: 'test1', pageSize: 1 });
      await fdcApi.searchFoods({ query: 'test2', pageSize: 1 });
      await fdcApi.searchFoods({ query: 'test3', pageSize: 1 });
      
      const elapsed = Date.now() - startTime;
      
      // Should take at least 2 seconds (3 requests at min 1/sec)
      expect(elapsed).toBeGreaterThanOrEqual(1500);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('Caching', () => {
    it('should cache results and return cached data on second call', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      const mockResponse = {
        foods: [
          { fdcId: 1, description: 'Test Food', brandName: 'Test Brand' },
        ],
        totalHits: 1,
      };

      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => {
          // Simulate network delay for first call
          await new Promise(resolve => setTimeout(resolve, 100));
          return mockResponse;
        },
      });

      // First call - should hit API
      const start1 = Date.now();
      const result1 = await fdcApi.searchFoods({ query: 'cached test', pageSize: 5 });
      const time1 = Date.now() - start1;

      // Second call - should hit cache
      const start2 = Date.now();
      const result2 = await fdcApi.searchFoods({ query: 'cached test', pageSize: 5 });
      const time2 = Date.now() - start2;

      // Results should be identical
      expect(result1).toEqual(result2);
      
      // Second call should be much faster (cache hit)
      expect(time2).toBeLessThan(50); // Cache should be <50ms
      expect(time1).toBeGreaterThan(time2 * 5); // Cold call should be >5x slower
      
      // Fetch should only be called once (first call)
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use different cache keys for different queries', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      await fdcApi.searchFoods({ query: 'query1', pageSize: 5 });
      await fdcApi.searchFoods({ query: 'query2', pageSize: 5 });

      // Should make 2 API calls (different queries)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should use different cache keys for different page sizes', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      await fdcApi.searchFoods({ query: 'same query', pageSize: 5 });
      await fdcApi.searchFoods({ query: 'same query', pageSize: 10 });

      // Should make 2 API calls (different page sizes)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('API Key Handling', () => {
    it('should return null when API key is missing', async () => {
      delete process.env.FDC_API_KEY;
      
      const { fdcApi } = await import('../fdc-api');
      
      const result = await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should make API calls when API key is present', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const callUrl = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(callUrl).toContain('api_key=test-key');
    });
  });

  describe('Error Handling', () => {
    it('should return null on API error', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      expect(result).toBeNull();
    });

    it('should return null on invalid JSON response', async () => {
      process.env.FDC_API_KEY = 'test-key';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'response' }), // Missing 'foods' array
      });

      const result = await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      expect(result).toBeNull();
    });
  });

  describe('ENABLE_BRANDED_SEARCH flag', () => {
    it('should search only Branded when flag is true', async () => {
      process.env.FDC_API_KEY = 'test-key';
      process.env.ENABLE_BRANDED_SEARCH = 'true';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('dataType=Branded');
      expect(url).not.toContain('Foundation');
    });

    it('should search multiple data types when flag is false', async () => {
      process.env.FDC_API_KEY = 'test-key';
      process.env.ENABLE_BRANDED_SEARCH = 'false';
      
      const { fdcApi } = await import('../fdc-api');
      
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ foods: [] }),
      });

      await fdcApi.searchFoods({ query: 'test', pageSize: 5 });
      
      const url = (global.fetch as jest.Mock).mock.calls[0][0];
      expect(url).toContain('dataType=Branded,Foundation,SR%20Legacy');
    });
  });
});

