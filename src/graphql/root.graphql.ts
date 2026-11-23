import { GraphQLError } from 'graphql'
import { GithubApiService } from '../services/github/github-api.service'
import { LastFMApiService } from '../services/last-fm/last-fm.api'
import { MutationSchema, Schema, UsageGraphQLContext } from './schema'
import { GoodreadsApiService } from '../services/goodreads/goodreads-api.service'
import { CacheManager } from './cache-manager'
import { config } from '../config'
import { UsageStore } from '../usage/usage-store'
import {
  CHATGPT_STALE_MS,
  CHATGPT_UPLOAD_MAX_AGE_MS,
  MACHINES_STALE_MS,
  MACHINES_UPLOAD_MAX_AGE_MS,
  isFreshUpload,
  isStale,
  normalizeChatGPTSnapshot,
  normalizeMachineSnapshot,
} from '../usage/validators'
import { CollectorCredentials, createCollectorAccessGuard } from '../auth/cloudflare-access'
import { OpencodeUsageService } from '../services/opencode/opencode-usage.service'
import { ChatGPTUsageSnapshot, MachineSnapshot } from './schema'

export interface UsageCredentials {
  chatgpt: CollectorCredentials
  machines: CollectorCredentials
}

export interface UsageDependencies {
  /** SQLite-backed snapshot storage. Created by the app and closed on shutdown. */
  store: UsageStore
  /**
   * jose key resolver for Cloudflare Access verification. Production defaults to
   * the remote JWKS (cached ~10 minutes); tests inject a local JWKS.
   */
  accessKeys?: import('jose', { with: { 'resolution-mode': 'import' } }).JWTVerifyGetKey
  /** Per-mutation Access application credentials; defaults to the env config. */
  credentials?: UsageCredentials
  /** OpenCode Go usage bearer token; defaults to the env config. An empty value means not configured. */
  opencodeApiKey?: string
}

export function createRoot(cacheManager: CacheManager, usage: UsageDependencies) {
  const githubAPI = new GithubApiService()
  const lastFMAPI = new LastFMApiService()
  const goodReadsApiService = new GoodreadsApiService()
  const opencodeAPI = new OpencodeUsageService(usage.opencodeApiKey ?? config.usage.opencodeApiKey)
  const accessGuard = createCollectorAccessGuard({ keys: usage.accessKeys })
  const credentials: UsageCredentials = usage.credentials ?? {
    chatgpt: { audience: config.usage.chatgptSync.audience, clientId: config.usage.chatgptSync.clientId },
    machines: { audience: config.usage.machinesSync.audience, clientId: config.usage.machinesSync.clientId },
  }

  const readChatgptUsage = async (): Promise<ChatGPTUsageSnapshot | null> => {
    const stored = usage.store.read('chatgpt')
    if (!stored) return null
    const snapshot = normalizeChatGPTSnapshot(JSON.parse(stored.payload))
    return snapshot ? { ...snapshot, stale: isStale(snapshot.fetchedAt, CHATGPT_STALE_MS) } : null
  }

  const readMachines = async (): Promise<MachineSnapshot | null> => {
    const stored = usage.store.read('machines')
    if (!stored) return null
    const snapshot = normalizeMachineSnapshot(JSON.parse(stored.payload))
    return snapshot ? { ...snapshot, stale: isStale(snapshot.fetchedAt, MACHINES_STALE_MS) } : null
  }

  const accessToken = (context: UsageGraphQLContext): string | undefined => {
    const header = context.reply.request.headers['cf-access-jwt-assertion']
    return typeof header === 'string' ? header : undefined
  }

  return {
    Query: {
      githubStatus: () => cacheManager.cachedResponse('githubStatus', () => githubAPI.getGithubStatus(), 2),
      latestCommit: () => cacheManager.cachedResponse('latestCommit', () => githubAPI.getLatestCommit(), 2),
      listening: () => cacheManager.cachedResponse('listening', () => lastFMAPI.getSongListening(), 60 * 60),
      reading: () => cacheManager.cachedResponse('reading', () => goodReadsApiService.lastReading(), 2),
      chatgptUsage: () => cacheManager.cachedResponse('chatgptUsage', readChatgptUsage, config.usage.readCacheTtl),
      machines: () => cacheManager.cachedResponse('machines', readMachines, config.usage.readCacheTtl),
      opencodeUsage: () =>
        cacheManager.cachedResponse('opencodeUsage', () => opencodeAPI.getUsage(), config.usage.opencodeCacheTtl),
    },
    Mutation: {
      uploadChatgptUsage: async (_parent, args, context) => {
        await accessGuard(accessToken(context), credentials.chatgpt)
        const snapshot = normalizeChatGPTSnapshot(args.input)
        if (!snapshot) {
          throw new GraphQLError('Invalid ChatGPT usage snapshot')
        }
        if (!isFreshUpload(snapshot.fetchedAt, CHATGPT_UPLOAD_MAX_AGE_MS)) {
          throw new GraphQLError('ChatGPT usage snapshot is stale or dated in the future')
        }
        usage.store.save('chatgpt', snapshot)
        cacheManager.invalidate('chatgptUsage')
        return { ...snapshot, stale: false }
      },
      uploadMachines: async (_parent, args, context) => {
        await accessGuard(accessToken(context), credentials.machines)
        const snapshot = normalizeMachineSnapshot(args.input)
        if (!snapshot) {
          throw new GraphQLError('Invalid machines snapshot')
        }
        if (!isFreshUpload(snapshot.fetchedAt, MACHINES_UPLOAD_MAX_AGE_MS)) {
          throw new GraphQLError('Machines snapshot is stale or dated in the future')
        }
        usage.store.save('machines', snapshot)
        cacheManager.invalidate('machines')
        return { ...snapshot, stale: false }
      },
    },
  } satisfies { Query: Schema; Mutation: MutationSchema }
}
