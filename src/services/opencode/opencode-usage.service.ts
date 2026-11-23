import axios from 'axios'
import { Logger } from '../../logger'
import { OpenCodeUsage, UsageMeter } from '../../graphql/schema'

const UPSTREAM_URL = 'https://opencode.ai/console/api/go/status'
const WINDOWS = ['fiveHour', 'week', 'month']

function microCents(value: unknown): bigint | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value)
  return null
}

/**
 * `null`/absent means the window has not started yet (the upstream returns a
 * null resetsAt for an idle 5-hour window). Anything else must be a real date,
 * so junk is still rejected as undefined.
 */
function resetTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/**
 * Reduce the Console response to the three Go allowance meters. The upstream
 * document also contains billing and account fields that must never reach the
 * client.
 */
export function normalizeGoMeters(payload: unknown): UsageMeter[] {
  const meters = (payload as { access?: { meters?: unknown } } | null | undefined)?.access?.meters
  if (!meters || typeof meters !== 'object') throw new Error('Usage payload has no allowance meters')

  return WINDOWS.map(window => {
    const meter = (meters as Record<string, unknown>)[window]
    if (!meter || typeof meter !== 'object') throw new Error(`Usage payload has no ${window} meter`)

    const limit = microCents((meter as Record<string, unknown>).limitMicroCents)
    const used = microCents((meter as Record<string, unknown>).usedMicroCents)
    const resetsAt = resetTime((meter as Record<string, unknown>).resetsAt)
    if (limit === null || used === null || resetsAt === undefined) {
      throw new Error(`Usage payload has an invalid ${window} meter`)
    }

    const percent = limit === 0n ? 0 : Number((used * 10000n) / limit) / 100
    return { window, usedPercent: Math.min(100, Math.max(0, percent)), resetsAt }
  })
}

/** Live proxy of the OpenCode Go usage meters. Nothing is persisted here. */
export class OpencodeUsageService {
  private readonly logger = new Logger('OpencodeUsageService')

  constructor(private readonly apiKey?: string) {}

  async getUsage(): Promise<OpenCodeUsage> {
    const apiKey = this.apiKey?.trim()
    if (!apiKey) throw new Error('OpenCode usage API key is not configured')

    try {
      const response = await axios.get<unknown>(UPSTREAM_URL, {
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        // Never follow redirects: the bearer credential must not reach another location.
        maxRedirects: 0,
        timeout: 8000,
      })
      return { meters: normalizeGoMeters(response.data), fetchedAt: new Date().toISOString() }
    } catch {
      // Status only: never log account data, API keys, headers, or response bodies.
      this.logger.warn('OpenCode usage upstream request failed')
      throw new Error('OpenCode usage is unavailable')
    }
  }
}
