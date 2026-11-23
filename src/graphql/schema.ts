import { buildSchema } from 'graphql'
import type { FastifyReply } from 'fastify'

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
    url: String,
    profileUrl: String
  }

  type UsageMeter {
    window: String!
    usedPercent: Float!
    resetsAt: String
  }

  type ChatGPTUsageSnapshot {
    version: Int!
    plan: String!
    fetchedAt: String!
    meters: [UsageMeter!]!
    stale: Boolean!
  }

  type Machine {
    id: String!
    name: String!
    dnsName: String!
    os: String!
    online: Boolean
    addresses: [String!]!
    lastSeen: String
    openCodeVersion: String
    codexVersion: String
    claudeCodeVersion: String
  }

  type MachineSnapshot {
    version: Int!
    fetchedAt: String!
    machines: [Machine!]!
    stale: Boolean!
  }

  type OpenCodeUsage {
    meters: [UsageMeter!]!
    fetchedAt: String!
  }

  type Query {
    githubStatus: GithubStatus
    latestCommit: LatestCommit
    listening: LastSong
    reading: Reading
    chatgptUsage: ChatGPTUsageSnapshot
    machines: MachineSnapshot
    opencodeUsage: OpenCodeUsage
  }

  type Mutation {
    uploadChatgptUsage(input: ChatGPTUsageInput!): ChatGPTUsageSnapshot!
    uploadMachines(input: MachinesInput!): MachineSnapshot!
  }

  input UsageMeterInput {
    window: String!
    usedPercent: Float!
    resetsAt: String
  }

  input ChatGPTUsageInput {
    version: Int!
    plan: String!
    fetchedAt: String!
    meters: [UsageMeterInput!]!
  }

  input MachineInput {
    id: String!
    name: String!
    dnsName: String!
    os: String!
    online: Boolean
    addresses: [String!]!
    lastSeen: String
    openCodeVersion: String
    codexVersion: String
    claudeCodeVersion: String
  }

  input MachinesInput {
    version: Int!
    fetchedAt: String!
    machines: [MachineInput!]!
  }
`)

export interface GithubStatus {
  status: string
  updatedAt: string | null
  bio: string
  company: string | null
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
  title: string
  updatedAt: string
  url: string
  profileUrl: string
}

export interface UsageMeter {
  window: string
  usedPercent: number
  resetsAt: string | null
}

export interface ChatGPTUsageSnapshot {
  version: number
  plan: string
  fetchedAt: string
  meters: UsageMeter[]
  stale: boolean
}

export interface Machine {
  id: string
  name: string
  dnsName: string
  os: string
  online: boolean | null
  addresses: string[]
  lastSeen: string | null
  openCodeVersion: string | null
  codexVersion: string | null
  claudeCodeVersion: string | null
}

export interface MachineSnapshot {
  version: number
  fetchedAt: string
  machines: Machine[]
  stale: boolean
}

export interface OpenCodeUsage {
  meters: UsageMeter[]
  fetchedAt: string
}

export interface UsageMeterInput {
  window: string
  usedPercent: number
  resetsAt?: string | null
}

export interface ChatGPTUsageInput {
  version: number
  plan: string
  fetchedAt: string
  meters: UsageMeterInput[]
}

export interface MachineInput {
  id: string
  name: string
  dnsName: string
  os: string
  online?: boolean | null
  addresses: string[]
  lastSeen?: string | null
  openCodeVersion?: string | null
  codexVersion?: string | null
  claudeCodeVersion?: string | null
}

export interface MachinesInput {
  version: number
  fetchedAt: string
  machines: MachineInput[]
}

/** The default Mercurius context: `{ app, reply }`. Mutations read the collector JWT header from it. */
export interface UsageGraphQLContext {
  reply: FastifyReply
}

export interface Schema {
  githubStatus: () => Promise<GithubStatus>
  latestCommit: () => Promise<LatestCommit | null>
  listening: () => Promise<LastSong | null>
  reading: () => Promise<Reading>
  chatgptUsage: () => Promise<ChatGPTUsageSnapshot | null>
  machines: () => Promise<MachineSnapshot | null>
  opencodeUsage: () => Promise<OpenCodeUsage>
}

export interface MutationSchema {
  uploadChatgptUsage: (
    parent: unknown,
    args: { input: ChatGPTUsageInput },
    context: UsageGraphQLContext,
  ) => Promise<ChatGPTUsageSnapshot>

  uploadMachines: (
    parent: unknown,
    args: { input: MachinesInput },
    context: UsageGraphQLContext,
  ) => Promise<MachineSnapshot>
}
