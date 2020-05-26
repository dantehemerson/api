import { buildSchema } from 'graphql'

export const schema = buildSchema(`
  type Query {
    status: String
    workingOn: String
    contributions: String
  }
`)

export interface Schema {
  status: () => Promise<string>
  workingOn: () => Promise<string>
  contributions: () => Promise<string>
}
