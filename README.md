# 🐙 dantecalderon API

My GraphQL API

💡 It provides information about my:

* Github Status (Github API)
* Contributions in last year(Github API)
* Latest commit(Github API)
* Listening(Last.fm API)
* Goodreads - Reading Status

### 🚀 Install and Run

Requires Node.js 24 LTS (managed by `mise.toml` and `.nvmrc`).

```sh
mise install
mise exec -- npm ci --include=dev
cp .env.example .env
# Fill in GitHub and Last.fm credentials in .env.
mise exec -- npm run start:dev
```

The API exposes `/graphql`, the GraphiQL explorer at `/graphiql`, and `/health`.

### 📊 Usage endpoints

The API owns the dashboard usage data:

* `chatgptUsage` — latest ChatGPT allowance snapshot (`stale: true` past 10 minutes)
* `machines` — latest Tailscale machines snapshot (`stale: true` past 15 minutes)
* `opencodeUsage` — live proxy of the OpenCode Go usage meters, cached 60s
* `uploadChatgptUsage` / `uploadMachines` — collector mutations. They require a
  Cloudflare Access **service token** in the `cf-access-jwt-assertion` header;
  each mutation verifies its own Access application (audience + client id from
  `CHATGPT_USAGE_SYNC_*` / `MACHINES_SYNC_*`), rejects human logins, and fails
  closed if the pair is not configured. Queries stay public.

Snapshots are validated exactly like the previous dash Worker (version, plan,
meter windows, machine key sets, upload freshness within 10/15 minutes) and are
persisted as JSON blobs in a local SQLite database (`node:sqlite`, no native
modules) at `USAGE_DB_PATH` (default `./data/usage.db`). The ChatGPT snapshot is
kept indefinitely — a sleeping Mac shows stale data rather than nothing — while
machines snapshots expire 30 days after their last write. OpenCode Go usage is
never stored, only proxied with the `OPENCODE_USAGE_API_KEY` bearer token.

**The SQLite file is now the only copy of the usage history** — nothing else
stores it. Back it up with the host; in Docker the path is the `/app/data`
volume declared in the Dockerfile.

Env vars: `USAGE_DB_PATH`, `OPENCODE_USAGE_API_KEY`,
`CHATGPT_USAGE_SYNC_AUD`, `CHATGPT_USAGE_SYNC_CLIENT_ID`, `MACHINES_SYNC_AUD`,
`MACHINES_SYNC_CLIENT_ID`, plus the optional TTLs `OPENCODE_USAGE_CACHE_TTL`
and `USAGE_READ_CACHE_TTL` (seconds). The sync pairs are public Cloudflare
Access application identifiers, one per collector — see `.env.example`.

#### ⚠️ Required setup: Cloudflare Access in front of `/graphql`

The mutations above are **implemented and tested**, but they need a Cloudflare
Access application on `api.dantecalderon.com` path `/graphql` before the
collectors can upload. Without it, no `cf-access-jwt-assertion` header ever
arrives and the mutations fail closed with
`Collector authentication is not configured`.

See **[docs/cloudflare-access-setup.md](docs/cloudflare-access-setup.md)** for
the full walkthrough: the two-layer authentication model, the dashboard steps,
and how to verify it.

### Checks and production

```sh
mise exec -- npm run check
mise exec -- npm audit
mise exec -- npm start # after npm run build (included in check)
```

`check` verifies formatting, strictly type-checks source and tests, runs the Node.js
test suite, and builds the production output. Tests mock external APIs and require
no credentials. Live upstream access still requires valid credentials.

The Docker image uses Node.js 24, installs only production dependencies in the
runtime stage, and runs as a non-root user:

```sh
docker build -t dantecalderon-api .
docker run --rm --env-file .env -p 3000:3000 dantecalderon-api
```

TypeScript is a build-only dependency. Development and tests use `tsx` and Node's
built-in test runner, avoiding a TypeScript-version-dependent Jest transform.

### ⚖️ License

[MIT](./LICENSE)
