/**
 * Keyed hash of a Supabase user id, for `MappingEventLog.userHash` (s457 UID-1).
 *
 * - Never log or store the raw id; only this 16-hex tag.
 * - The secret (`TELEMETRY_USER_HASH_SECRET`) must NEVER rotate: it re-keys every hash.
 * - Secret unset or shorter than 32 chars -> null, silently. The detector is the post-deploy
 *   live proof: a bearer row with NULL means the secret is missing.
 * - The secret is read PER CALL, so tests and a restart-edited .env behave the same.
 */
import { createHmac } from 'crypto';

/** `userHash` for dev-key callers. */
export const MEL_USER_HASH_DEV = 'dev';
/** `userHash` after account deletion unlinks a user's rows. */
export const MEL_USER_HASH_DELETED = 'deleted';

export function hashUserIdForTelemetry(userId: string | null | undefined): string | null {
  if (!userId) return null;
  const secret = process.env.TELEMETRY_USER_HASH_SECRET ?? '';
  if (secret.length < 32) return null;
  return createHmac('sha256', secret).update(userId, 'utf8').digest('hex').slice(0, 16);
}
