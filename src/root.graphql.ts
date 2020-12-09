import { GithubAPI } from './github-api'
import { LastFMAPI } from './last-fm.api'
import { Schema } from './schema'

const githubAPI = new GithubAPI()
const lastFMAPI = new LastFMAPI()

export const root: { Query: Schema } = {
  Query: {
    githubStatus: () => githubAPI.getGithubStatus(),
    latestCommit: () => githubAPI.getLatestCommit(),
    listening: () => lastFMAPI.getSongListening(),
  },
}
