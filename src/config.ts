require('dotenv').config()

export const config = {
  githubToken: process.env.GITHUB_TOKEN,
  port: process.env.PORT || 3000,
  githubUsername: process.env.GITHUB_USERNAME || 'dantehemerson'
}
