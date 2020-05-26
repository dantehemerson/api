import { Schema } from './schema'

export const root: Schema = {
  status: async () => {
    return 'alksjl'
  },
  contributions: async () => {
    return '3600 contributions the last year'
  },
  workingOn: async () => {
    return '@dantecalderon'
  }
}
