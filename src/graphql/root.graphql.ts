import { GithubApiService } from '../services/github/github-api.service'
import { LastFMApiService } from '../services/last-fm/last-fm.api'
import { Schema } from './schema'
import { GoodreadsApiService } from '../services/goodreads/goodreads-api.service'

const githubAPI = new GithubApiService()
const lastFMAPI = new LastFMApiService()
const goodReadsApiService = new GoodreadsApiService()

export const root: { Query: Schema } = {
  Query: {
    githubStatus: () => githubAPI.getGithubStatus(),
    latestCommit: () => githubAPI.getLatestCommit(),
    listening: () => lastFMAPI.getSongListening(),
    reading: () => goodReadsApiService.lastReading(),
  },
}
