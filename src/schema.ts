import { buildSchema } from 'graphql'

export const schema = buildSchema(`
  type GithubStatus  {
    status: String
    bio: String
    company: String
    contributions: Int
  }

  type Query {
    githubStatus: GithubStatus
  }
`)

export interface GithubStatus {
  status: string
  bio: string
  company: string
  contributions: number
}
export interface Schema {
  githubStatus: () => Promise<GithubStatus>
}
