/**
 * Shared bearer-token comparison.
 *
 * Extracted from src/upload-auth.ts so the agent-runs ingest endpoint reuses
 * exactly this comparison rather than growing a second, subtly different one.
 * Upload's public API is unchanged.
 */
import { timingSafeEqual } from 'crypto'

/**
 * Constant-time `Authorization: Bearer <token>` check.
 *
 * Different-length inputs fail fast — timingSafeEqual requires equal lengths,
 * and length is not the secret.
 */
export function checkBearerToken(expected: string, authorizationHeader: string | undefined): boolean {
  if (!authorizationHeader) return false
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim())
  if (!match) return false
  const provided = match[1].trim()
  if (provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}
