import { GithubApiService } from '../services/github/github-api.service'
import { LastFMApiService } from '../services/last-fm/last-fm.api'
import { Schema } from './schema'
import { GoodreadsApiService } from '../services/goodreads/goodreads-api.service'
import { CacheManager } from './cache-manager'

export function createRoot(cacheManager: CacheManager) {
  const githubAPI = new GithubApiService()
  const lastFMAPI = new LastFMApiService()
  const goodReadsApiService = new GoodreadsApiService()

  return {
    Query: {
      githubStatus: () => cacheManager.cachedResponse('githubStatus', () => githubAPI.getGithubStatus(), 2),
      latestCommit: () => cacheManager.cachedResponse('latestCommit', () => githubAPI.getLatestCommit(), 2),
      listening: () => cacheManager.cachedResponse('listening', () => lastFMAPI.getSongListening(), 60 * 60),
      reading: () => cacheManager.cachedResponse('reading', () => goodReadsApiService.lastReading(), 2),
    },
  } satisfies { Query: Schema }
}
