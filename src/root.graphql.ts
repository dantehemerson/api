import { GithubAPI } from './github-api'
import { Schema } from './schema'

const githubAPI = new GithubAPI()

export const root: { Query: Schema } = {
  Query: {
    githubStatus: async () => githubAPI.getGithubStatus(),
    latestCommit: async () => githubAPI.getLatestCommit()
  }
}
