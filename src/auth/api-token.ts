import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Collector authentication with first-party API tokens.
 *
 * A token is an opaque random string. The API never stores the token itself,
 * only its SHA-256 hash, so a leaked environment file does not grant write
 * access. The collector presents the token in the `Authorization: Bearer`
 * header; the API hashes it and compares the digest against the stored hash
 * with a constant-time comparison.
 *
 * Each collector has its own token, and each token is bound to exactly one
 * mutation. The ChatGPT token cannot write a machines snapshot and vice versa.
 *
 * This is an alternative to the Cloudflare Access service-token exchange, which
 * requires an Access application in front of this host. Both can be enabled at
 * once; see `src/auth/cloudflare-access.ts`.
 */

/** How a token is presented on the wire. */
const BEARER_PREFIX = 'bearer '

/** Minimum token length in bytes of entropy before base64url encoding. */
const TOKEN_BYTES = 32

export type ApiTokenKind = 'chatgpt' | 'machines'

export interface ApiTokenCredentials {
  /** The token's SHA-256 hash, hex-encoded. Undefined means not configured. */
  hash?: string
}

export type ApiTokenGuard = (token: string | undefined) => Promise<void>

/**
 * Generate a new collector token. The plaintext is returned once and must be
 * given to the collector; only its hash belongs in the API environment.
 */
export function generateApiToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

/** Hash a token for storage. The hash is what goes in the environment. */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Extract the bearer token from an `Authorization` header value. Returns
 * undefined for anything that is not a single bearer credential. A token is
 * base64url text, so whitespace is never valid inside it.
 */
export function parseBearerToken(header: string | undefined): string | undefined {
  if (typeof header !== 'string') return undefined
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return undefined
  const token = header.slice(BEARER_PREFIX.length).trim()
  if (token.length === 0 || /\s/.test(token)) return undefined
  return token
}

/**
 * Compare a presented token against a stored hash in constant time. Both sides
 * are hashed first so the comparison is over equal-length buffers regardless of
 * the token's length, and the result is compared with `timingSafeEqual` so the
 * comparison time does not depend on how many leading bytes matched.
 */
export function tokenMatchesHash(token: string, expectedHash: string): boolean {
  if (typeof token !== 'string' || token.length === 0) return false
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false

  const presented = Buffer.from(hashApiToken(token), 'hex')
  const expected = Buffer.from(expectedHash.toLowerCase(), 'hex')
  if (presented.length !== expected.length) return false

  return timingSafeEqual(presented, expected)
}

/**
 * Build a guard that accepts only the configured token. It fails closed: a
 * missing or mismatched token is rejected, and so is an unconfigured
 * deployment. Nothing about the token is ever logged.
 */
export function createApiTokenGuard(credentials: ApiTokenCredentials): ApiTokenGuard {
  return async token => {
    if (!credentials.hash) {
      throw new Error('Collector authentication is not configured')
    }
    if (!token) {
      throw new Error('Missing collector API token')
    }
    if (!tokenMatchesHash(token, credentials.hash)) {
      throw new Error('Invalid collector API token')
    }
  }
}
