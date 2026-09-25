import { createHash, timingSafeEqual } from 'crypto';

/**
 * Compare a presented secret against the expected one without leaking, through
 * response timing, how many leading characters matched.
 *
 * Both sides are SHA-256 hashed first so the buffers handed to `timingSafeEqual()` are
 * always the same length — it throws on unequal lengths, and a length check of its own
 * would leak the secret's length.
 *
 * FAILS CLOSED: an unset or empty value on EITHER side is `false`, so an unset env var
 * authorizes nothing (the same rule `matchesDevApiKey()` has always had).
 */
export function safeEqualSecret(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!presented || !expected) return false;
  const a = createHash('sha256').update(presented, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}
