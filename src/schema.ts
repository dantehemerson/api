import { buildSchema } from 'graphql'

export const schema = buildSchema(`
  type GithubStatus  {
    status: String
    bio: String
    company: String
    contributions: Int
  }

  type LatestCommit {
    message: String
    createdAt: String
    url: String
  }

  type Query {
    githubStatus: GithubStatus
    latestCommit: LatestCommit
  }
`)

export interface GithubStatus {
  status: string
  bio: string
  company: string
  contributions: number
}

export interface LatestCommit {
  message: string
  createdAt: string
  url: string
}
export interface Schema {
  githubStatus: () => Promise<GithubStatus>
  latestCommit: () => Promise<LatestCommit>
}
