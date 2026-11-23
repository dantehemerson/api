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
