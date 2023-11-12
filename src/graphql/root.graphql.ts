import { GithubApiService } from '../services/github/github-api.service'
import { LastFMApiService } from '../services/last-fm/last-fm.api'
import { Schema } from './schema'
import { GoodreadsApiService } from '../services/goodreads/goodreads-api.service'
import { CacheManager } from './cache-manager'

const cacheManager = new CacheManager()

const githubAPI = new GithubApiService()
const lastFMAPI = new LastFMApiService()
const goodReadsApiService = new GoodreadsApiService()

export const root: { Query: Schema } = {
  Query: {
    githubStatus: () =>
      cacheManager.cachedReponse('githubStatus', () => githubAPI.getGithubStatus(), 2),
    latestCommit: () =>
      cacheManager.cachedReponse('latestCommit', () => githubAPI.getLatestCommit(), 2),
    listening: () => cacheManager.cachedReponse('listening', () => lastFMAPI.getSongListening(), 60 * 60),
    reading: () =>
      cacheManager.cachedReponse('reading', () => goodReadsApiService.lastReading(), 2
  },
}
