// Release 3S -- browser-safe token facts (NO node imports: this file is reachable
// from client components such as the Chat card). Token generation, which needs
// node:crypto, stays server-side in token.ts.
export const SHARE_TOKEN_LENGTH = 43
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

/** Cheap shape check done BEFORE any database lookup, so junk never reaches the database. */
export function isPlausibleShareToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_RE.test(value)
}
