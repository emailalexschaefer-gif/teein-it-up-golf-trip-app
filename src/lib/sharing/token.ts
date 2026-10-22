// Release 3S -- share-link tokens (SERVER ONLY: uses node:crypto). 32 random bytes
// (256 bits) encoded as 43 URL-safe characters: not guessable, not sequential,
// not derived from any id. Client-safe helpers live in tokenShape.ts.
import { randomBytes } from 'node:crypto'

export { SHARE_TOKEN_LENGTH, isPlausibleShareToken } from './tokenShape'

export function generateShareToken(): string {
  return randomBytes(32).toString('base64url')
}
