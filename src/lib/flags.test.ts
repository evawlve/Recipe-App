/**
 * Tests for feature flags
 * Verifies that flags are read correctly from environment variables
 */

import { ENABLE_PORTION_V2, ENABLE_BRANDED_SEARCH, getEnvFlag } from './flags';

describe('Feature Flags', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original process.env
    process.env = originalEnv;
  });

  describe('ENABLE_PORTION_V2', () => {
    it('should default to false when not set', () => {
      delete process.env.ENABLE_PORTION_V2;
      // Need to re-import to get fresh value, but since it's a const, we test getEnvFlag instead
      expect(getEnvFlag('ENABLE_PORTION_V2', false)).toBe(false);
    });

    it('should be true when set to "true"', () => {
      process.env.ENABLE_PORTION_V2 = 'true';
      expect(getEnvFlag('ENABLE_PORTION_V2', false)).toBe(true);
    });

    it('should be true when set to "1"', () => {
      process.env.ENABLE_PORTION_V2 = '1';
      expect(getEnvFlag('ENABLE_PORTION_V2', false)).toBe(true);
    });

    it('should be false when set to "false"', () => {
      process.env.ENABLE_PORTION_V2 = 'false';
      expect(getEnvFlag('ENABLE_PORTION_V2', false)).toBe(false);
    });
  });

  describe('ENABLE_BRANDED_SEARCH', () => {
    it('should default to false when not set', () => {
      delete process.env.ENABLE_BRANDED_SEARCH;
      expect(getEnvFlag('ENABLE_BRANDED_SEARCH', false)).toBe(false);
    });

    it('should be true when set to "true"', () => {
      process.env.ENABLE_BRANDED_SEARCH = 'true';
      expect(getEnvFlag('ENABLE_BRANDED_SEARCH', false)).toBe(true);
    });

    it('should be true when set to "1"', () => {
      process.env.ENABLE_BRANDED_SEARCH = '1';
      expect(getEnvFlag('ENABLE_BRANDED_SEARCH', false)).toBe(true);
    });
  });

  describe('getEnvFlag', () => {
    it('should return default value when env var is not set', () => {
      delete process.env.TEST_FLAG;
      expect(getEnvFlag('TEST_FLAG', false)).toBe(false);
      expect(getEnvFlag('TEST_FLAG', true)).toBe(true);
    });

    it('should return true for "true" and "1"', () => {
      process.env.TEST_FLAG = 'true';
      expect(getEnvFlag('TEST_FLAG', false)).toBe(true);
      
      process.env.TEST_FLAG = '1';
      expect(getEnvFlag('TEST_FLAG', false)).toBe(true);
    });

    it('should return false for other values', () => {
      process.env.TEST_FLAG = 'false';
      expect(getEnvFlag('TEST_FLAG', true)).toBe(false);
      
      process.env.TEST_FLAG = '0';
      expect(getEnvFlag('TEST_FLAG', true)).toBe(false);
      
      process.env.TEST_FLAG = 'yes';
      expect(getEnvFlag('TEST_FLAG', true)).toBe(false);
    });
  });
});

