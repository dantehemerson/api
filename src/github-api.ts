import axios, { AxiosRequestConfig } from 'axios'
import { config } from './config'
import { getWithState } from './utils'
import emoji from 'node-emoji'
import { GithubStatus, LatestCommit } from './schema'

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

  async getLatestCommit(): Promise<LatestCommit> {
    try {
      const data = await axios
        .get(`https://api.github.com/users/${config.githubUsername}/events/public`)
        .then(response => response.data)

      let latestCommit
      const latestPushEvent = data.find(event => {
        if (event.type !== 'PushEvent') return false
        latestCommit = event.payload.commits.reverse().find(commit => commit.author)
        return Boolean(latestCommit)
      })

      if (!latestCommit) return null

      return {
        message: latestCommit.message.trim().split('\n')[0].trim(),
        createdAt: latestPushEvent.created_at,
        url: `https://github.com/${latestPushEvent.repo.name}/commit/${latestCommit.sha}`
      }
    } catch {
      return null
    }
  }
}
