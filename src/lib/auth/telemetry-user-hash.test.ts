/**
 * hashUserIdForTelemetry() — the keyed tag on MappingEventLog.userHash (s457 UID-1).
 */
import { hashUserIdForTelemetry, MEL_USER_HASH_DEV, MEL_USER_HASH_DELETED } from './telemetry-user-hash';

const ID = 'b3f1c2d4-0000-4000-8000-00000000abcd';

describe('hashUserIdForTelemetry', () => {
  beforeEach(() => {
    process.env.TELEMETRY_USER_HASH_SECRET = 'k'.repeat(32);
  });
  afterEach(() => {
    delete process.env.TELEMETRY_USER_HASH_SECRET;
  });

  test('h1: a pinned HMAC-SHA256 prefix, stable across calls', () => {
    expect(hashUserIdForTelemetry(ID)).toBe('3e2705a4de1d0d10');
    expect(hashUserIdForTelemetry(ID)).toBe(hashUserIdForTelemetry(ID));
  });

  test('h2: a different id gives a different pinned tag', () => {
    expect(hashUserIdForTelemetry('user-1')).toBe('82e362bc8631b252');
  });

  test('h3: a different secret re-keys the tag', () => {
    process.env.TELEMETRY_USER_HASH_SECRET = 'j'.repeat(32);
    expect(hashUserIdForTelemetry(ID)).toBe('96905b720eaa2e11');
  });

  test('h4: an unset or short secret returns null', () => {
    delete process.env.TELEMETRY_USER_HASH_SECRET;
    expect(hashUserIdForTelemetry(ID)).toBeNull();
    process.env.TELEMETRY_USER_HASH_SECRET = 'k'.repeat(31);
    expect(hashUserIdForTelemetry(ID)).toBeNull();
  });

  test('h5: a null or empty id returns null', () => {
    expect(hashUserIdForTelemetry(null)).toBeNull();
    expect(hashUserIdForTelemetry('')).toBeNull();
  });

  test('h6: 16 lowercase hex chars that do not contain the id; marker constants', () => {
    const h = hashUserIdForTelemetry(ID) as string;
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain(ID);
    expect(MEL_USER_HASH_DEV).toBe('dev');
    expect(MEL_USER_HASH_DELETED).toBe('deleted');
  });
});
