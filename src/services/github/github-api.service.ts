import axios, { AxiosRequestConfig } from 'axios'
import { config } from '../../config'
import { get as getEmoji } from 'node-emoji'
import { GithubStatus, LatestCommit } from '../../graphql/schema'

interface Viewer {
  bio: string | null
  company: string | null
  status: { emoji: string | null; updatedAt: string; message: string | null } | null
  contributionsCollection: { contributionCalendar: { totalContributions: number } }
}

interface Commit {
  message: string
  sha: string
  author?: { name: string }
}

interface GithubEvent {
  type: string
  created_at: string
  repo: { name: string }
  payload: { commits?: Commit[] }
}

export class GithubApiService {
  private baseGQLRequestConfig: AxiosRequestConfig

  constructor() {
    this.baseGQLRequestConfig = {
      url: `https://api.github.com/graphql`,
      method: 'POST',
      timeout: 10_000,
      headers: {
        Authorization: `Bearer ${config.github.token}`,
      },
    }
  }

  private async query(gqlQuery: string) {
    const response = await axios<{ data?: { viewer: Viewer }; errors?: { message: string }[] }>({
      ...this.baseGQLRequestConfig,
      data: {
        query: gqlQuery,
      },
    })

    const json = response.data

    if (json.errors?.length || !json.data) {
      throw new Error(json.errors?.map(error => error.message).join('; ') || 'Missing GitHub data')
    }

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
            updatedAt
            message
          }
        }
      }
    `)

    const { viewer } = body
    const emoji = viewer.status?.emoji
    const statusEmoji = emoji ? (getEmoji(emoji) ?? emoji) : ''

    return {
      status: [statusEmoji, viewer.status?.message].filter(Boolean).join(' '),
      updatedAt: viewer.status?.updatedAt ?? null,
      bio: viewer.bio ?? 'A dreamer',
      company: viewer.company,
      contributions: viewer.contributionsCollection.contributionCalendar.totalContributions,
    }
  }

  async getLatestCommit(): Promise<LatestCommit | null> {
    try {
      const data = await axios
        .get<GithubEvent[]>(`https://api.github.com/users/${config.github.username}/events/public`, {
          timeout: 10_000,
        })
        .then(response => response.data)

      let latestCommit: Commit | undefined
      const latestPushEvent = data.find(event => {
        if (event.type !== 'PushEvent') return false
        latestCommit = event.payload.commits?.findLast(commit => commit.author)
        return Boolean(latestCommit)
      })

      return {
        message: latestCommit ? latestCommit.message.trim().split('\n')[0].trim() : 'feat: Hack complete',
        createdAt: latestCommit && latestPushEvent ? latestPushEvent.created_at : new Date().toISOString(),
        url:
          latestCommit && latestPushEvent
            ? `https://github.com/${latestPushEvent.repo.name}/commit/${latestCommit.sha}`
            : `https://github.com/${config.github.username}`,
      }
    } catch {
      return null
    }
  }
}
