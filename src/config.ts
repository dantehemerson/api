require('dotenv').config()

export const config = {
  port: parseInt(process.env.PORT) || 3000,

  /** Github */
  github: {
    username: process.env.GITHUB_USERNAME,
    token: process.env.GITHUB_TOKEN,
  },

  /** LastFM */
  lastFM: {
    username: process.env.LASTFM_USERNAME,
    apiKey: process.env.LASTFM_API_KEY,
  },
}
