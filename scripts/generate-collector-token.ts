#!/usr/bin/env node
import { generateApiToken, hashApiToken } from '../src/auth/api-token'

/**
 * Mint a collector API token and print the pair needed to deploy it.
 *
 * The plaintext token goes into the collector's private config. Only the hash
 * goes into the API environment. The plaintext is printed once and cannot be
 * recovered from the hash, so copy it before closing the terminal.
 *
 * Usage:
 *   npx tsx scripts/generate-collector-token.ts
 *   npx tsx scripts/generate-collector-token.ts chatgpt
 *   npx tsx scripts/generate-collector-token.ts machines
 */

const label = process.argv[2] ?? 'collector'
if (!/^[a-z0-9-]{1,32}$/.test(label)) {
  console.error('Invalid label. Use lowercase letters, digits and dashes.')
  process.exitCode = 1
} else {
  const token = generateApiToken()
  console.log(`Collector token for "${label}"`)
  console.log('')
  console.log('  token (collector config, secret):')
  console.log(`    ${token}`)
  console.log('')
  console.log('  hash (API environment, not secret):')
  console.log(`    ${hashApiToken(token)}`)
  console.log('')
  console.log('The token is shown once. Store the hash in the API environment and')
  console.log("the token in the collector's private config; never commit either.")
}
