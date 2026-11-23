export const CLOUDFLARE_ACCESS_ISSUER = 'https://old-fire-7d3d.cloudflareaccess.com'

/**
 * jose is ESM-only while this API compiles to CommonJS, so its types are
 * referenced with an import-mode type query and it is loaded at runtime
 * through a memoized dynamic import.
 */
type AccessKeys = import('jose', { with: { 'resolution-mode': 'import' } }).JWTVerifyGetKey

export interface CollectorCredentials {
  audience?: string
  clientId?: string
}

export type CollectorAccessGuard = (token: string | undefined, credentials: CollectorCredentials) => Promise<void>

/**
 * The default remote JWKS is created once and keeps a 10 minute cache
 * (mirroring the dash Worker) so it is never refetched per request.
 */
let defaultKeys: Promise<AccessKeys> | undefined

function loadDefaultKeys(): Promise<AccessKeys> {
  defaultKeys ??= (async () => {
    const { createRemoteJWKSet } = await import('jose')
    return createRemoteJWKSet(new URL(`${CLOUDFLARE_ACCESS_ISSUER}/cdn-cgi/access/certs`), {
      timeoutDuration: 5000,
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    })
  })()
  return defaultKeys
}

/**
 * Verifies a Cloudflare Access service-token JWT from the
 * `cf-access-jwt-assertion` header, exactly like the dash Worker did. Each
 * collector path has its own Access application, so the audience and client id
 * are pinned per mutation. Only service tokens are valid: a JWT must have
 * `type === 'app'`, `common_name === <client id>`, an empty `sub`, and no
 * `email` claim — human logins are rejected. Any failure (including JWKS
 * outages) fails closed, and nothing about the token is ever logged.
 */
export function createCollectorAccessGuard({ keys }: { keys?: AccessKeys } = {}): CollectorAccessGuard {
  return async (token, { audience, clientId }) => {
    if (!audience || !clientId) {
      throw new Error('Collector authentication is not configured')
    }
    if (!token) {
      throw new Error('Missing Cloudflare Access service token')
    }

    try {
      const [jose, resolver] = await Promise.all([import('jose'), keys ?? loadDefaultKeys()])
      const { payload } = await jose.jwtVerify(token, resolver, {
        algorithms: ['RS256'],
        issuer: CLOUDFLARE_ACCESS_ISSUER,
        audience,
        requiredClaims: ['exp', 'iat', 'common_name'],
      })
      // Service-token JWTs have an empty subject and common_name = Client ID.
      // Do not trust the raw client-id header or accept a human login here.
      if (
        payload.type !== 'app' ||
        payload.common_name !== clientId ||
        (payload.sub !== undefined && payload.sub !== '') ||
        payload.email !== undefined ||
        typeof payload.iat !== 'number' ||
        !Number.isFinite(payload.iat) ||
        payload.iat > Math.floor(Date.now() / 1000) + 30
      ) {
        throw new Error()
      }
    } catch {
      throw new Error('Invalid Cloudflare Access service token')
    }
  }
}
