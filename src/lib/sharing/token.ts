// Release 3S — share-link tokens. 32 random bytes (256 bits) encoded as 43
// URL-safe characters: not guessable, not sequential, not derived from any id.
import { randomBytes } from 'node:crypto'

export const SHARE_TOKEN_LENGTH = 43
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Cheap shape check done BEFORE any database lookup, so junk never reaches the database. */
export function isPlausibleShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value)
}
