import { config as loadEnv } from 'dotenv'

loadEnv({ quiet: true })

const secondsFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export const config = {
  port: Number.parseInt(process.env.PORT ?? '3000', 10),

  /** Github */
  github: {
    username: process.env.GITHUB_USERNAME,
    token: process.env.GITHUB_TOKEN,
  },

  /** LastFM */
  lastFM: {
    username: process.env.LASTFM_USERNAME,
    apiKey: process.env.LASTFM_API_KEY,
  },

  /** Usage snapshots (SQLite), collector authentication, and cache TTLs (seconds) */
  usage: {
    dbPath: process.env.USAGE_DB_PATH ?? './data/usage.db',
    opencodeApiKey: process.env.OPENCODE_USAGE_API_KEY,
    chatgptSync: {
      audience: process.env.CHATGPT_USAGE_SYNC_AUD,
      clientId: process.env.CHATGPT_USAGE_SYNC_CLIENT_ID,
    },
    machinesSync: {
      audience: process.env.MACHINES_SYNC_AUD,
      clientId: process.env.MACHINES_SYNC_CLIENT_ID,
    },
    /**
     * First-party collector API tokens. Only the SHA-256 hash of each token is
     * stored here; the plaintext lives solely in the collector's private
     * config. Generate a token with `generateApiToken()` and store
     * `hashApiToken(token)` in these variables.
     */
    chatgptTokenHash: process.env.CHATGPT_USAGE_TOKEN_HASH,
    machinesTokenHash: process.env.MACHINES_USAGE_TOKEN_HASH,
    opencodeCacheTtl: secondsFromEnv(process.env.OPENCODE_USAGE_CACHE_TTL, 60),
    readCacheTtl: secondsFromEnv(process.env.USAGE_READ_CACHE_TTL, 30),
  },
}
