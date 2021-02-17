import { buildSchema } from 'graphql'

export const schema = buildSchema(`
  type GithubStatus  {
    status: String
    updatedAt: String
    bio: String
    company: String
    contributions: Int
  }

  type LatestCommit {
    message: String
    createdAt: String
    url: String
  }

  type LastSong {
    name: String
    artist: String
    album: String
    url: String
    image: String
    playing: Boolean
    scrobbles: String
    lastPlayingDate: String
  }

  type Reading {
    title: String,
    updatedAt: String,
    url: String
  }

  type Query {
    githubStatus: GithubStatus
    latestCommit: LatestCommit
    listening: LastSong
    reading: Reading
  }
`)

export interface GithubStatus {
  status: string
  updatedAt: string
  bio: string
  company: string
  contributions: number
}

export interface LatestCommit {
  message: string
  createdAt: string
  url: string
}

export interface LastSong {
  name: string
  artist: string
  album: string
  url: string
  image: string
  playing: boolean
  scrobbles: string
  lastPlayingDate: string
}

export interface Reading {
  title: string,
  updatedAt: string,
  url: string
}

export interface Schema {
  githubStatus: () => Promise<GithubStatus>
  latestCommit: () => Promise<LatestCommit>
  listening: () => Promise<LastSong | null>
  reading: () => Promise<Reading>
}
