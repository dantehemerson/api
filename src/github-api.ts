import axios, { AxiosRequestConfig } from 'axios'
import { config } from './config'
import { getWithState } from './utils'
import emoji from 'node-emoji'
import { GithubStatus } from './schema'

export class GithubAPI {
  private baseGQLRequestConfig: AxiosRequestConfig

  constructor() {
    this.baseGQLRequestConfig = {
      url: `https://api.github.com/graphql`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.githubToken}`
      }
    }
  }

  private async query(gqlQuery: string) {
    const response = await axios({
      ...this.baseGQLRequestConfig,
      data: {
        query: gqlQuery
      }
    })

    const json = response.data

    return json.data
  }

  async getGithubStatus(): Promise<GithubStatus> {
    const body = await this.query(`
      {
        viewer {
          contributionsCollection {
            contributionCalendar {
              totalContributions
            }
          }
          bio
          company
          status {
            emoji
            message
          }
        }
      }
    `)

    const get = getWithState(body)

    return {
      status: `${emoji.get(get('viewer.status.emoji'))} ${get('viewer.status.message')}`,
      bio: get('viewer.bio', 'A dreamer'),
      company: get('viewer.company'),
      contributions: get('viewer.contributionsCollection.contributionCalendar.totalContributions')
    }
  }
}
