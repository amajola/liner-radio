# Liner Radio

A host-led listening room for uploaded music, built as a fixed-viewport React SPA.

## Stack

- React 19 and Vite
- Effect 4 HTTP server APIs
- Better Auth with verified email/password and Google accounts
- Drizzle ORM and Cloudflare D1
- Cloudflare R2 audio storage
- Cloudflare Workers Static Assets
- Durable Objects with WebSocket fan-out for live room sync
- Alchemy infrastructure, local runtime, and staged deployments
- Native browser audio with synchronized playback and crossfades

Authentication, API routes, profile images, and frontend assets all use the
same Worker origin. Static files are still served by Cloudflare's asset binding.

## Local development

Requires Bun 1.4 or newer, plus Node.js 22.13 or newer (the test runner uses
`node --experimental-strip-types`). Sign in to Cloudflare once with
`bun alchemy login`; Alchemy uses a local workerd runtime for the Worker and
isolated local D1 and R2 data.

```sh
bun install
bun run dev
```

Open <http://localhost:5173>. `alchemy dev` runs the React client, Effect Worker,
Better Auth, and locally simulated D1, R2, and Durable Object storage together.
The auth secret is generated once per Alchemy stage and kept in Alchemy state.
Without a `RESEND_API_KEY`, local verification and reset links are printed in
the terminal by the Worker so the flows can be tested end to end.

## Account services

Email/password accounts must verify their address before signing in. Forgotten
password links expire through Better Auth, and a successful reset revokes the
account's other sessions. Signed-in users can edit their display name and upload
a JPEG, PNG, or WebP profile picture up to 3 MB; pictures are stored in the
stage's private R2 bucket and served through the Worker.

Set these GitHub environment variables and secrets for both `production` and
`preview`:

| Name | Kind | Purpose |
| --- | --- | --- |
| `AUTH_EMAIL_FROM` | variable | Verified sender, for example `Liner Radio <accounts@example.com>` |
| `RESEND_API_KEY` | secret | Verification and password-reset delivery |
| `GOOGLE_CLIENT_ID` | variable | Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | secret | Google OAuth client secret |

Register these OAuth callbacks with each provider:

```text
https://YOUR_PRODUCTION_DOMAIN/api/auth/callback/google
https://YOUR_PR_PREVIEW_DOMAIN/api/auth/callback/google
```

Google can also use `http://localhost:5173/api/auth/callback/google` during local
development. The provider button only appears when that stage has both required
Google credentials.

## Commands

```sh
bun run dev                 # local SPA + Worker runtime
bun run typecheck           # TypeScript
bun run test                # domain and HTTP contract tests
bun run build               # production client bundle
bun run check               # all validation
bun run db:generate         # create a migration after schema changes
bun run deploy              # deploy the default personal Alchemy stage
bun run deploy:dev          # deploy the shared dev stage
bun run deploy:prod         # deploy production
bun run destroy:dev         # remove the shared dev stage
```

## Environments and deployment

[`alchemy.run.ts`](./alchemy.run.ts) owns the Worker, static assets, D1 database
and migrations, R2 bucket, Durable Object namespace, auth secret, and Worker
observability. Alchemy applies pending files from `drizzle/` during deployment,
so migrations and application code move together.

- A push to `main` verifies the project and deploys the `prod` stage.
- Opening or updating a pull request into `main` deploys an isolated `pr-N` stage.
- Closing the pull request destroys that preview database, bucket, Worker, and state.

The GitHub `production` and `preview` environments need
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets (repository secrets
also work). The Cloudflare token needs Workers Scripts Write, Workers R2 Storage
Write, D1 Write, and Account Settings Write permissions.

The first production run uses Alchemy's `--adopt` mode to take ownership of the
existing `liner-radio` Worker and database and the `liner-radio-tracks` bucket.
Production D1 and R2 resources have a retain policy, so even an accidental
`alchemy destroy --stage prod` leaves their data in Cloudflare. Alchemy creates
a new Better Auth signing secret during this handover, so existing production
sessions sign in again once; later deployments reuse the stored value.

To create a cloud environment for a branch without opening a pull request, use a
safe stage name and remove it when finished:

```sh
bun alchemy deploy --stage feature-player --yes
bun alchemy destroy --stage feature-player --yes
```

Only upload audio you own or have permission to stream. Uploads are capped at
30 MB each, 200 tracks and 1 GB per account.

## Playback sync

Each room is a `RoomChannel` Durable Object and the only writer for that room.
Every host action is applied there, persisted to D1, and pushed to all connected
devices over WebSockets, so listeners converge in milliseconds instead of on a
poll boundary. HTTP polling remains as an automatic fallback whenever the socket
is down.

Devices align their clocks by timing `ping`/`pong` round trips and keeping the
lowest-latency sample, then place the needle from the room's `startedAt`. Small
drift is corrected by trimming playback rate by up to 2.5%; only gaps over a
second are corrected with an audible seek.

The Durable Object also sets an alarm one crossfade before the current track
ends, so the queue keeps rolling even if the host's browser is closed or asleep.

After the initial or recovery snapshot, the room sends typed revisioned deltas
for queue, request, playback, mixer, membership, and permission changes. Clients
runtime-validate each message and apply accepted deltas directly to the room's
TanStack Query cache. A missed revision requests a fresh authoritative snapshot;
an optimistic duplicate is ignored. Slow sockets are closed and reconnect to a
snapshot rather than accumulating an unbounded transactional backlog.

Reconnect delays use exponential backoff with jitter. In development, current
RTT, server-clock offset, reconnect count, socket state, and room revision are
available in the browser console as `window.__LINER_RADIO_DIAGNOSTICS__`.

Browsers refuse to start audio without user activation. A device that joins a
running room tries to play immediately and, if the browser blocks it, surfaces a
single "Tap to play" control rather than failing silently.

## Audio delivery

The library API returns stable track metadata, while the player resolves a
short-lived, HMAC-signed playback grant before loading audio. The grant carries
the immutable R2 object metadata, so browser byte-range requests only verify the
signature: they do not repeat Better Auth and D1 queries.

Whole-object responses are cached under a private internal Cloudflare cache key.
After the first edge miss, authorized listeners can receive full or ranged audio
from that cache without making another R2 read. The public playback URL still
contains a required expiring grant; the R2 bucket remains private.

The player also resolves the current track early and preloads the next queued
track in a silent audio element. Data-saver devices skip that speculative media
download. Responses expose `Server-Timing` and `X-Media-Cache: HIT|MISS` headers
so startup latency and cache behavior can be inspected without logging secrets.

## Room lifecycle

A host can rename or delete a room from the room settings modal, reachable from
the room bar or from any room in the lobby. Deleting asks a second time, because
it ends the session for everyone.

Closing a room deletes its row, pushes a terminal `room:closed` event to every
connected device, and clears the Durable Object's alarm so a deleted room cannot
keep advancing a queue. Listeners see a modal explaining what happened and are
returned to the lobby; their client stops reconnecting rather than retrying a
room that no longer exists. A host leaving the room closes it the same way, so
listeners are never left in a room with no one running it.

## Layout model

The document itself never scrolls, and neither does any panel of content. Only
lists scroll: the room list, the library, the queue and the request inbox each
scroll inside a fixed frame. Where content cannot fit a small screen it moves
behind a modal rather than growing the page, which is why the lobby's create and
join forms collapse into buttons below 780px. On mobile, a bottom navigation bar switches
between those full-height panels and safe-area insets are respected.
