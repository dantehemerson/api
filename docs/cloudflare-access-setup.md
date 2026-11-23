# Cloudflare Access setup for the usage mutations

The `uploadChatgptUsage` and `uploadMachines` mutations are already
authenticated. This document explains **how**, and the one Cloudflare
configuration step that is still missing.

## TL;DR

The API-side authentication is **done and tested**. What is missing is a
Cloudflare Access application in front of `api.dantecalderon.com/graphql`.
Until that exists, collector uploads fail closed with
`Collector authentication is not configured`.

- [ ] 1. Create a self-hosted Access application for `api.dantecalderon.com` path `/graphql`
- [ ] 2. Add Service Auth policies for the two existing collector service tokens
- [ ] 3. Copy the new application's **AUD tag** into the API host env
- [ ] 4. Point each Mac collector's config at the new endpoint
- [ ] 5. Delete the two now-dead dash Access apps

## The two layers

Authentication is split deliberately. Neither layer is sufficient alone.

### Layer 1 — Cloudflare Access (the edge)

This is the credential exchange. The collector presents a **service token**:

```http
CF-Access-Client-Id: <client id>.access
CF-Access-Client-Secret: <client secret>
```

Those are a shared secret, so Cloudflare cannot let them reach the origin
directly. Instead, Cloudflare validates them itself and **swaps them for a
signed JWT**, injecting:

```http
cf-access-jwt-assertion: <signed JWT>
```

Cloudflare never touches the usage data. It only proves a valid credential
exists and mints a signed assertion about it.

### Layer 2 — the API-side verifier

`src/auth/cloudflare-access.ts` verifies that assertion. This is the check that
actually gates the write:

1. Read `cf-access-jwt-assertion` from the request.
2. Verify the RS256 signature against the team JWKS
   (`https://old-fire-7d3d.cloudflareaccess.com/cdn-cgi/access/certs`),
   checking `iss`, `aud` and expiry.
3. Require it to be a **service token**, not a human session:
   - `type === 'app'`
   - `common_name === <the exact client id>` for that mutation
   - `sub` is empty or absent
   - **no `email` claim**

Step 3 is what rejects a logged-in browser. A human Access session carries
`sub` and `email`; a service token carries neither. So even someone holding a
valid human Access cookie cannot upload.

**Raw `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers are never
accepted by the API** — there is no signature on them to verify. This mirrors
the old dash Worker, which had a test asserting exactly that
(`raw service-token headers never authenticate a request`).

### Why the edge layer cannot be skipped

Because the raw headers are a shared secret, only Cloudflare can convert them
into a signed assertion. Skip layer 1 and layer 2 has nothing to verify — the
API correctly rejects the request.

Conversely, layer 1 alone is not enough: Access would happily forward a
*human* session too, and an Access app shared with humans would let a browser
post to the mutation.

## Current state

| Host | Behind Access? | Consequence |
| --- | --- | --- |
| `dash.dantecalderon.com` | yes (`old-fire-7d3d`) | dashboard is Access-protected |
| `api.dantecalderon.com/graphql` | **no** | mutations fail closed |

The Access JWKS is **account-wide**, not per-application — the same
`old-fire-7d3d` team signs every application. So the API's verifier works with
any new Access app in that team; only the per-application **aud** differs.

## Step 1 — Create the Access application

In the Cloudflare Zero Trust dashboard: **Access → Applications → Add an
application → Self-hosted**.

| Field | Value |
| --- | --- |
| Application name | `dantecalderon-api-graphql` |
| Session duration | 24 hours |
| Domain | `api.dantecalderon.com` |
| Path | `/graphql` |

Use a **self-hosted** application so it can be scoped to the `/graphql` path.
A SaaS application cannot be path-scoped. Scoping to the path keeps
`/health`, `/graphiql` and anything else on the host public — only the
GraphQL endpoint is gated.

## Step 2 — Add Service Auth policies

Add a **Service Auth** policy (not an Allow policy — Allow is for humans and
would let a browser through).

For each of the two existing collector tokens, add an Include rule:

| Action | Rule type | Selector |
| --- | --- | --- |
| Service Auth | Service Token | the ChatGPT collector token |
| Service Auth | Service Token | the Machines collector token |

The existing token client ids are:

| Collector | Client id | Used by |
| --- | --- | --- |
| ChatGPT usage | `309a932876a5bc7698196b162b53ec2a.access` | `uploadChatgptUsage` |
| Machines | `5f4605beb492b2c1887f2d6820fd7fe8.access` | `uploadMachines` |

Reuse the tokens you already created — do not mint new ones. The API checks
`common_name === <client id>`, and `common_name` is the **token's** identity,
not the application's, so the client ids stay exactly as they are.

You can put both tokens in one policy or use two policies. Two is clearer and
keeps the per-application isolation visible.

> **Note:** these two tokens each have their own dedicated Cloudflare Access
> application today, scoped to the old dash paths. Those apps become dead once
> this app is in place — see step 5.

### Strict service token authentication

Under the Zero Trust organization setting **Strict service token
authentication**, a failed service-token request returns `401`/`403` instead of
redirecting to the login page, and only Service Auth policies can authorize a
service-token request. This is the behaviour you want for machine traffic. It
is on by default for organizations created after 2026-10-05 — check it under
**Settings → Authentication**.

## Step 3 — Set the AUD tag on the API host

The new application has its own **AUD tag**, shown on its overview page. It
differs from the old dash apps' audiences, so update the API host env:

```sh
CHATGPT_USAGE_SYNC_AUD=<new app AUD tag>
CHATGPT_USAGE_SYNC_CLIENT_ID=309a932876a5bc7698196b162b53ec2a.access
MACHINES_SYNC_AUD=<new app AUD tag>
MACHINES_SYNC_CLIENT_ID=5f4605beb492b2c1887f2d6820fd7fe8.access
```

The two collectors share one application, so both audiences are the same
value. The **client ids stay unchanged**.

If the audience is wrong the mutation fails closed with
`Invalid Cloudflare Access service token` — the error message does not
distinguish a bad audience from a bad signature, so check the AUD tag first
when debugging.

## Step 4 — Point the Mac collectors at the new endpoint

Each Mac keeps its collector config private (mode `0600`) outside the repo.
Update the `endpoint` field to the GraphQL API and rerun the installer:

```json
{
  "endpoint": "https://api.dantecalderon.com/graphql",
  "accessClientId": "…",
  "accessClientSecret": "…"
}
```

The installers refuse to overwrite a different existing config without
`--upgrade-owned`, so pass that flag when re-running them.

The service token **secret does not change** — it is the same token, now
attached to a different Access application.

## Step 5 — Delete the dead dash Access apps

The old dash collector apps were path-scoped to
`/api/chatgpt-usage/snapshot` and `/api/machines/snapshot`. Those routes no
longer exist on the Worker, so those apps now protect nothing.

Once the new app is verified working, delete them. Keep the app that protects
the **dashboard itself** (`dash.dantecalderon.com`) — that one is still
serving the pages and assets.

Do not delete the old apps before verifying the new one, or you lose the
ability to fall back.

## Verifying it works

From a machine holding the collector config:

```sh
curl -s -o /dev/null -w "%{http_code}\n" https://api.dantecalderon.com/graphql \
  -X POST \
  -H 'content-type: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d '{"query":"{ chatgptUsage { version } }"}'
```

Expect `200`. Then check that the mutation is actually reachable with the
token, and that it is *not* reachable without one:

```sh
# with the token -> 200
curl -s -X POST https://api.dantecalderon.com/graphql \
  -H 'content-type: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -d '{"query":"mutation { uploadMachines(input:{version:1,fetchedAt:\"2026-01-01T00:00:00Z\",machines:[]}) { stale } }"}'

# without the token -> a GraphQL error, never a successful write
curl -s -X POST https://api.dantecalderon.com/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"mutation { uploadMachines(input:{version:1,fetchedAt:\"2026-01-01T00:00:00Z\",machines:[]}) { stale } }"}'
```

Without a token the API must answer with a GraphQL `errors` array — remember
that GraphQL returns **HTTP 200** even for errors, so check the body, not the
status code.

To confirm the edge is really exchanging the token, check that the request
reaching the origin carries `cf-access-jwt-assertion`. The API's own error
messages tell you which stage failed:

| Error | Meaning |
| --- | --- |
| `Collector authentication is not configured` | the API host env vars are missing |
| `Missing Cloudflare Access service token` | the request arrived with no assertion — the Access app is not covering the path, or the token headers were not sent |
| `Invalid Cloudflare Access service token` | signature/audience/client-id mismatch, or a human session was presented |

## Rotating the tokens

Both collector service tokens expire **2027-11-17**. To rotate before then,
create a new token in the dashboard, add it to the same Service Auth policy,
update the Mac config with the new client id and secret, and only then revoke
the old one. The client id is pinned in the API env, so update
`CHATGPT_USAGE_SYNC_CLIENT_ID` / `MACHINES_SYNC_CLIENT_ID` at the same time.
