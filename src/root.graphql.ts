import { GithubAPI } from './github-api'
import { Schema } from './schema'

const githubAPI = new GithubAPI()

export const root: Schema = {
  githubStatus: async () => githubAPI.getGithubStatus()
}
