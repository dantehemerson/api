# Brief: Move usage endpoints / storage / cache from `dash` to `dantecalderon-api`

You are working in `/Users/d/coding/repos/dantecalderon-api` (a Fastify 5 + Mercurius
GraphQL API, Node 24, TypeScript, `node:test`).

A sibling repo, `/Users/d/coding/dash`, currently serves the dashboard and holds
**all** usage endpoints, storage and caching on **Cloudflare Workers KV**. The KV
account is hitting its usage quota, so the entire usage surface must move into
this API.

## Goal

Own all usage data in this GraphQL API, persisted in a local SQLite database
file on the API host. `dash` becomes a static-asset + auth-only frontend that
talks to this API.

## Hard constraints

1. **Keep the existing GraphQL style.** `src/graphql/schema.ts` uses
   `buildSchema` with a template literal, plus exported TypeScript interfaces
   and a `Schema` interface that the resolver map satisfies. Extend that
   pattern — do not introduce a SDL-file/`makeExecutableSchema` rewrite, and do
   not add a code-first framework.
2. **Resolvers live in `src/graphql/root.graphql.ts`.** `createRoot(cacheManager)`
   returns `{ Query: {...} } satisfies { Query: Schema }`. Add `Mutation` to that
   object and widen the `Schema` interface to include it.
3. **Node 24 only.** `node:sqlite` (`DatabaseSync`) is available — verify with
   `mise exec -- node -e "require('node:sqlite')"`. Do **not** add
   `better-sqlite3` or any native module; the Docker image is `node:24-alpine`
   and native builds would break it.
4. **`jose` is not currently a dependency.** You need it to verify the
   Cloudflare Access service-token JWT. Add `jose` to `dependencies` in
   `package.json` (the `dash` repo pins `jose@6.2.16`; use the same major).
5. **Match the existing code style exactly**: no semicolons, single quotes,
   2-space indent, `.prettierrc` in the repo root governs formatting. Run
   `npm run format` before committing.
6. **`npm run check` must pass**: format check, `tsc --noEmit` for src and
   `tsconfig.test.json`, `npm test`, and `npm run build`.
7. **Tests use `node:test` + `node:assert/strict`**, no mocking framework.
   External HTTP is mocked via `mockUpstream` in `test/helpers.ts`. New tests
   go in `test/*.test.ts` and are picked up by `npm test`.
8. **Do not commit secrets.** `.env` is gitignored. Add new env var *names* to
   `.env.example`.

## Data contract (copy these exactly — `dash` is being changed to match)

### 1. ChatGPT usage snapshot

Source of truth in `dash`: `/Users/d/coding/dash/server/chatgpt-usage.mjs`
(read it). Snapshot shape:

```ts
{ version: 1, plan: 'free'|'plus'|'pro'|'team'|'business'|'enterprise'|'edu'|'unknown',
  fetchedAt: string /* ISO */, meters: [{ window: 'fiveHour'|'week', usedPercent: number, resetsAt: string|null }] }
```

### 2. Tailscale machines snapshot

Source of truth in `dash`: `/Users/d/coding/dash/server/tailscale-machines.mjs`
(read it). Shape: `{ version: 1, fetchedAt: string, machines: [...] }` — see the
file for the exact machine fields (`id`, `name`, `dnsName`, `os`, `online`,
`addresses`, `lastSeen`, `openCodeVersion`, optional `codexVersion` /
`claudeCodeVersion`).

### 3. OpenCode Go usage

Source of truth in `dash`: `/Users/d/coding/dash/server/opencode-go-usage.mjs`
(read it). The API must **proxy** `https://opencode.ai/console/api/status` with
a bearer token from env (`OPENCODE_USAGE_API_KEY`) and normalize it to three
meters (`fiveHour`, `week`, `month`) of `{ window, usedPercent, resetsAt }`,
exactly like `normalizeGoMeters` does. The upstream payload contains billing
and account fields that **must never** reach the client — keep the reduction
strict.

## Required GraphQL schema

```graphql
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
  stale: Boolean!          # true when fetchedAt is older than 10 minutes
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
  # ...existing fields unchanged...
  chatgptUsage: ChatGPTUsageSnapshot
  machines: MachineSnapshot
  opencodeUsage: OpenCodeUsage
}

type Mutation {
  uploadChatgptUsage(input: ChatGPTUsageInput!): ChatGPTUsageSnapshot!
  uploadMachines(input: MachinesInput!): MachineSnapshot!
}
```

For the two mutations, define **input object types** carrying the raw
snapshot, e.g.:

```graphql
input UsageMeterInput { window: String!  usedPercent: Float!  resetsAt: String }
input ChatGPTUsageInput { version: Int!  plan: String!  fetchedAt: String!  meters: [UsageMeterInput!]! }
input MachineInput { id: String!  name: String!  dnsName: String!  os: String!  online: Boolean  addresses: [String!]!  lastSeen: String  openCodeVersion: String  codexVersion: String  claudeCodeVersion: String }
input MachinesInput { version: Int!  fetchedAt: String!  machines: [MachineInput!]! }
```

GraphQL `Float` is a double; `usedPercent` values are 0–100 with two decimals.
**Round-tripping matters**: the stored snapshot must serialize back to the exact
same JSON the collector uploaded, because `dash` validates the response shape
strictly (`src/lib/chatgpt-usage-format.mjs`). Store the snapshot as a JSON
**text blob** in SQLite (see below) rather than normalizing it into columns —
that guarantees byte-identical round-trips and keeps validation in one place.

## Storage: SQLite

Use `node:sqlite`'s `DatabaseSync`. Design:

- A single table, e.g.:

  ```sql
  CREATE TABLE IF NOT EXISTS usage_snapshots (
    kind       TEXT PRIMARY KEY,      -- 'chatgpt' | 'machines'
    payload    TEXT NOT NULL,         -- JSON snapshot
    fetched_at TEXT NOT NULL,         -- ISO timestamp of the snapshot
    updated_at TEXT NOT NULL          -- ISO timestamp of the write
  );
  ```

- Database path from env, e.g. `USAGE_DB_PATH`, defaulting to
  `./data/usage.db` (create the `data` directory if missing). The Dockerfile
  must declare a `VOLUME` for that path and the entrypoint must be able to
  write there — pick a path the non-root `node` user can write (e.g.
  `/app/data`), and `mkdir -p` + `chown` it in the Dockerfile if needed.
- **ChatGPT snapshot: keep the last snapshot indefinitely** (a sleeping Mac
  should show stale data, not have it vanish). Do not expire it.
- **Machines snapshot: expire after 30 days** (this mirrors the current
  `expirationTtl: 60*60*24*30` on the KV write). Implement expiry by
  deleting rows older than the cutoff on write and on read, or by filtering
  them out — your choice, but it must actually stop serving 31-day-old data.
- OpenCode Go usage is **not stored** — it is proxied live each time. But the
  *normalized* result should be cached briefly in-process to avoid hammering
  the upstream (see the existing `CacheManager`; use it, e.g. a 60s TTL).
- A `stale` flag is computed from `fetchedAt` age:
  ChatGPT > 10 minutes → stale; machines > 15 minutes → stale. These match
  the current thresholds in `dash`.

## Validation (port it, do not weaken it)

`dash` validates snapshots **before** storing them and rejects stale uploads.
Port both validators into this repo and apply them on write:

- `normalizeChatGPTSnapshot` / `validateSnapshot` semantics:
  - exactly the keys `version`, `plan`, `fetchedAt`, `meters`; `version === 1`;
  - `plan` in the allowed set;
  - `fetchedAt` an ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SS(.mmm)?Z`);
  - 1–2 meters, windows from `{ fiveHour, week }`, no duplicates, meters
    sorted in that window order;
  - `usedPercent` a finite number in [0, 100];
  - `resetsAt` `null` or a valid ISO timestamp.
- Upload freshness: reject a snapshot whose `fetchedAt` is more than 10
  minutes old, or more than 60 seconds in the future (`age < -60_000` /
  `age > 10*60_000`). This prevents replaying an old local file as fresh.
- Machines validation: exactly the keys `version`, `fetchedAt`, `machines`;
  ≤ 100 machines; per-machine exact key sets (the optional version fields are
  optional); `id` matching `/^[\w:-]{1,128}$/` and unique; `name` non-empty
  and ≤ 128 chars; `dnsName` ≤ 254; `os` ≤ 32; `addresses` an array of ≤ 8
  strings each ≤ 64 chars, de-duplicated; `lastSeen` `null` or ISO;
  CLI versions `null` or matching `/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/`.
  Machines upload freshness: ≤ 15 minutes old, ≤ 60 s in the future.

Throw a GraphQL error with a clear message when validation fails. Mercurius
turns a thrown error into a GraphQL `errors` array with a 200 status — make
sure the error message is useful and never leaks the raw payload.

## Authentication for the mutations

The collectors on the user's Macs authenticate with a **Cloudflare Access
service token**, exactly as they do today against the Worker. The API must
verify that token itself instead of relying on the Worker to do it.

Two separate Access applications exist today, one per collector path, each
with its own audience and client id. Preserve that separation:

| collector | current Worker env var | purpose |
|---|---|---|
| ChatGPT usage | `CHATGPT_USAGE_SYNC_AUD` / `CHATGPT_USAGE_SYNC_CLIENT_ID` | `uploadChatgptUsage` |
| Machines | `MACHINES_SYNC_AUD` / `MACHINES_SYNC_CLIENT_ID` | `uploadMachines` |

Values (from `/Users/d/coding/dash/wrangler.jsonc` — these are public
identifiers, not secrets):

- ChatGPT: audience `a1a4c03f1338b531d3135e6913e35b825caccad371b0297c7941fa8eff686883`,
  client id `309a932876a5bc7698196b162b53ec2a.access`
- Machines: audience `fdc8b0d4a7cf390a1abf1ef1edb9e3e1fbbdc3653593599a043034da3254b2f7`,
  client id `5f4605beb492b2c1887f2d6820fd7fe8.access`

The Cloudflare Access issuer is `https://old-fire-7d3d.cloudflareaccess.com`.

Verification rules (port `createCollectorAccessGuard` from
`/Users/d/coding/dash/server/chatgpt-usage-access.mjs` — read it):

- The service token arrives as the `cf-access-jwt-assertion` **header** on the
  GraphQL HTTP request.
- Verify with `jose`'s `jwtVerify` against a remote JWKS at
  `https://old-fire-7d3d.cloudflareaccess.com/cdn-cgi/access/certs`,
  `algorithms: ['RS256']`, the configured `issuer`, the configured `audience`,
  `requiredClaims: ['exp','iat','common_name']`.
- **Only service tokens are valid.** A service-token JWT has
  `type === 'app'`, `common_name === <client id>`, an **empty** `sub`, and no
  `email` claim. A human login must be rejected. Reject if
  `payload.type !== 'app'` or `payload.common_name !== clientId`, or if
  `payload.sub` is present and non-empty, or if `payload.email` is present, or
  if `payload.iat` is not finite or is more than 30 s in the future.
- The audience and client id must be **per-mutation** (ChatGPT mutation checks
  the ChatGPT pair, machines mutation checks the machines pair).
- Config comes from env, e.g. `CHATGPT_USAGE_SYNC_AUD`,
  `CHATGPT_USAGE_SYNC_CLIENT_ID`, `MACHINES_SYNC_AUD`,
  `MACHINES_SYNC_CLIENT_ID`. If a pair is missing, the mutation must fail
  closed (do not accept unauthenticated uploads).
- Use a `createRemoteJWKSet` with a cache (`cacheMaxAge` ~10 min) so the JWKS
  is not refetched per request, mirroring `dash`.
- **Never log the token, the claims, or the raw payload.** On failure log only
  a generic message.

Since Mercurius handles routing, read the `cf-access-jwt-assertion` header in
the resolver from the Fastify request context (`context.reply.request.headers`
in Mercurius — verify the exact accessor for Mercurius 16 / GraphQL 17 and
use what actually works). Put the guard in a dedicated module, e.g.
`src/auth/cloudflare-access.ts`, so it is unit-testable.

**Also add a Fastify preHandler hook** on the GraphQL route that rejects the
whole request when a mutation is attempted without a valid token? — No: the
resolver-level check is enough and simpler, because queries are public while
mutations are not. Keep it at the resolver level.

## Caching

The API already has `src/graphql/cache-manager.ts` (`node-cache`, `cachedResponse`).

- The OpenCode Go upstream call must be cached (60s TTL) so a dashboard poll
  does not hit `opencode.ai` every time.
- The ChatGPT/machines **reads** should also be cached very briefly (e.g. 30–60s)
  so the dashboard's 60-second polling does not re-query SQLite on every hit.
  Keep the TTLs in one place and make them configurable by env if convenient.

## Configuration additions

Add to `src/config.ts` and `.env.example`:

- `USAGE_DB_PATH` (default `./data/usage.db`)
- `OPENCODE_USAGE_API_KEY`
- `CHATGPT_USAGE_SYNC_AUD`, `CHATGPT_USAGE_SYNC_CLIENT_ID`
- `MACHINES_SYNC_AUD`, `MACHINES_SYNC_CLIENT_ID`
- `OPENCODE_USAGE_CACHE_TTL` / `USAGE_READ_CACHE_TTL` (optional, seconds)

## Deployment notes

- `Dockerfile`: add a `VOLUME` for the SQLite data dir and make sure the
  non-root `node` user can write to it.
- The API is currently deployed as a Docker image; there is no deploy
  workflow in the repo any more (it was removed in commit `1206a59`). Do
  **not** add one unless asked. Just make the Dockerfile correct.
- `README.md` must document the new endpoints, the env vars, the SQLite file
  location, and the backup story (the SQLite file is now the only copy of the
  usage data — say so).

## Tests to write (`test/usage.test.ts` and/or similar)

Use `node:test`. Cover at least:

1. `uploadChatgptUsage` with a **valid** Cloudflare Access service token stores
   the snapshot; the subsequent `chatgptUsage` query returns it with the exact
   meters, `plan`, `fetchedAt`, and `stale: false`.
2. `uploadChatgptUsage` **without** a token → GraphQL error, nothing stored.
3. `uploadChatgptUsage` with a **human-login** token (a JWT with `sub` set to
   a user, `type` not `'app'`, or an `email` claim) → GraphQL error.
4. `uploadChatgptUsage` with the **machines** client's token → rejected
   (cross-application isolation).
5. `uploadChatgptUsage` with an **invalid snapshot** (bad plan, bad window,
   out-of-range `usedPercent`, wrong key set, duplicate windows) → GraphQL
   error, nothing stored.
6. `uploadChatgptUsage` with a **stale** snapshot (fetchedAt 11 minutes ago) →
   rejected; with one from 30 s in the future → rejected.
7. Same battery for `uploadMachines` / `machines` query, including the 30-day
   expiry and the 15-minute `stale` flag.
8. `opencodeUsage` calls the upstream exactly once for two queries within the
   cache TTL, normalizes the three windows, and **never** returns the
   upstream's billing/account fields. Use the existing `mockUpstream` helper.
9. `opencodeUsage` fails cleanly (GraphQL error) when the upstream returns
   non-2xx, and when no API key is configured.
10. Round-trip fidelity: the JSON the client uploaded comes back out
    semantically identical (same keys, same values, same meter order).

To mint test tokens, use `jose` exactly like `dash` does in
`/Users/d/coding/dash/tests/chatgpt-usage-access.test.mjs` and
`/Users/d/coding/dash/tests/worker.test.mjs` — read those files for the
`generateKeyPair` / `exportJWK` / `createLocalJWKSet` / `SignJWT` pattern,
and inject a local JWKS so the tests need no network.

## Out of scope

- Do **not** modify `/Users/d/coding/dash`. That repo is being changed in
  parallel by someone else. Just read it for the contract.
- Do not touch the existing `githubStatus` / `latestCommit` / `listening` /
  `reading` resolvers or their schema types.
- Do not add a public HTTP REST endpoint alongside the GraphQL API.

## Definition of done

1. `npm run check` passes clean (format, typecheck, tests, build).
2. New GraphQL queries/mutations work as described above.
3. Snapshots persist in SQLite across an app restart.
4. Tests cover the auth matrix, the validation matrix, caching, and
   round-trip fidelity.
5. `README.md` and `.env.example` document everything.
6. Dockerfile handles the SQLite volume and permissions.
7. Committed on `master` and pushed to `origin` (the repo's convention is to
   commit and push directly to `master`; the user has authorized pushing).
