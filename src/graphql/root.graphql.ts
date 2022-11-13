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
      cacheManager.cachedReponse('githubStatus', () => githubAPI.getGithubStatus(), 60 * 10 /* 10 minutes */),
    latestCommit: () =>
      cacheManager.cachedReponse('latestCommit', () => githubAPI.getLatestCommit(), 60 * 5 /* 5 minutes */),
    listening: () => cacheManager.cachedReponse('listening', () => lastFMAPI.getSongListening(), 30 /* 30 seconds */),
    reading: () =>
      cacheManager.cachedReponse('reading', () => goodReadsApiService.lastReading(), 60 * 30 /* 30 minutes */),
  },
}
