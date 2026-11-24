# Collector API tokens

The `uploadChatgptUsage` and `uploadMachines` mutations are authenticated with
**first-party API tokens**. This removes the dependency on a Cloudflare Access
application in front of this host.

## How it works

A token is an opaque random string. The API stores **only its SHA-256 hash**,
never the token itself:

```
Collector ──[Authorization: Bearer <token>]──▶ API
                                                 │ sha256(token)
                                                 │ timingSafeEqual vs stored hash
                                                 │ bound to one mutation
                                                 ▼
                                            allow / deny
```

Because only the hash is stored, a leaked environment file does not let an
attacker upload. Because the comparison is constant-time, the response timing
does not leak the hash.

Each token is bound to **exactly one mutation**:

| Env var | Authorizes |
| --- | --- |
| `CHATGPT_USAGE_TOKEN_HASH` | `uploadChatgptUsage` only |
| `MACHINES_USAGE_TOKEN_HASH` | `uploadMachines` only |

The ChatGPT token cannot write a machines snapshot, and vice versa. This
mirrors the per-application isolation the Cloudflare Access service tokens
provided.

## Generating a token

```sh
mise exec -- npm run token:generate -- chatgpt
```

```
Collector token for "chatgpt"

  token (collector config, secret):
    -Njbm3nQPcdB15fTb-otHaMAq4sJK0DZinSU-6JWQIg

  hash (API environment, not secret):
    e28697f727d6f6bf429cdffdb76e24b56609fe5a050fcbd4cf0ab065327a9dd7
```

The plaintext is shown **once** and cannot be recovered from the hash. Copy it
before closing the terminal.

- **token** → the collector's private config, mode `0600`
- **hash** → the API host environment (`CHATGPT_USAGE_TOKEN_HASH` /
  `MACHINES_USAGE_TOKEN_HASH`)

Never commit either value.

## Deploying it

1. Generate one token per collector.
2. Put the hashes in the API host environment and restart the API.
3. Put the plaintext tokens in each Mac's collector config, alongside the
   `endpoint`, and rerun the collector installer with `--upgrade-owned`.
4. The collector sends `Authorization: Bearer <token>` on the upload request.

## Rotating a token

Rotation is an environment change plus a config change, and it needs no code
deployment:

1. Generate a new token.
2. Update the hash in the API host environment and restart the API.
3. Update the token in the Mac's collector config and rerun the installer.
4. Only then discard the old token.

Because the API only ever sees hashes, the old token stops working the moment
its hash is replaced.

## Failure modes

| Message | Meaning |
| --- | --- |
| `Collector authentication is not configured` | the hash env var is missing or empty on the API host |
| `Missing collector API token` | no `Authorization` header, or it is not a bearer credential |
| `Invalid collector API token` | the token does not match this mutation's hash — wrong token, or the wrong collector's token |

A malformed `Authorization` header is rejected outright rather than falling
through to the Cloudflare Access path, so a mistyped token never silently
degrades into a different authentication mode.

## The Cloudflare Access fallback

If an Access application covers this host, the existing service-token
verification still works: the collector sends `CF-Access-Client-Id` /
`CF-Access-Client-Secret`, Cloudflare exchanges them for a signed
`cf-access-jwt-assertion`, and the API verifies that assertion.

A request is authenticated by the API token when it carries an
`Authorization` header, and by the Access assertion otherwise. Both fail
closed. See [cloudflare-access-setup.md](cloudflare-access-setup.md).

## What the API does not accept

- The raw `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers. There is
  no signature on them to verify, so the API never trusts them.
- A human Access session. The verifier requires `type === 'app'`,
  `common_name` equal to the pinned client id, an empty `sub` and no `email`
  claim, so a logged-in browser cannot upload.
