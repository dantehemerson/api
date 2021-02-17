import { GithubAPI } from './github-api'
import { LastFMAPI } from './last-fm.api'
import { Schema } from './schema'
import { GoodreadsApiService } from './services/goodreads/goodreads-api.service'

const githubAPI = new GithubAPI()
const lastFMAPI = new LastFMAPI()
const goodReadsApiService = new GoodreadsApiService()

export const root: { Query: Schema } = {
  Query: {
    githubStatus: () => githubAPI.getGithubStatus(),
    latestCommit: () => githubAPI.getLatestCommit(),
    listening: () => lastFMAPI.getSongListening(),
    reading: () => goodReadsApiService.lastReading(),
  },
}
