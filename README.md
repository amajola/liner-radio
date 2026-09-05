# Liner Radio

A host-led listening room for uploaded music, built as a fixed-viewport React SPA.

## Stack

- React 19 and Vite
- Effect 4 HTTP server APIs
- Better Auth with email/password sessions
- Drizzle ORM and Cloudflare D1
- Cloudflare R2 audio storage
- Cloudflare Workers Static Assets
- Durable Objects with WebSocket fan-out for live room sync
- Native browser audio with synchronized playback and crossfades

The static SPA is served directly from Cloudflare's edge cache. Only `/api/*`
requests invoke the Worker. Authentication, API routes, and frontend assets all
use the same origin.

## Local development

Requires Node.js 22.13 or newer.

```sh
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Open <http://localhost:5173>. The Vite development server runs the React client,
Effect Worker, Better Auth, and locally simulated D1 and R2 storage together.

The checked-in `.dev.vars` contains a development-only secret so this checkout
runs immediately. Replace it for your own environment. Never reuse it in
production.

## Commands

```sh
npm run dev                 # local SPA + Worker runtime
npm run typecheck           # TypeScript
npm test                    # domain and HTTP contract tests
npm run build               # production client + Worker bundles
npm run check               # all validation
npm run db:generate         # create a migration after schema changes
npm run db:migrate:local    # apply migrations to local D1
npm run db:migrate:remote   # apply migrations to production D1
npm run deploy              # build and deploy with Wrangler
```

## Production setup

1. Create a D1 database: `npx wrangler d1 create liner-radio`.
2. Create the audio bucket: `npx wrangler r2 bucket create liner-radio-tracks`.
3. Replace the placeholder `database_id` in `wrangler.jsonc` with its ID.
   The `RoomChannel` Durable Object needs no setup beyond the `v1` migration
   already declared in `wrangler.jsonc`; Wrangler applies it on first deploy.
4. Add a high-entropy Better Auth secret with
   `npx wrangler secret put BETTER_AUTH_SECRET`.
5. Set `BETTER_AUTH_URL` to the final HTTPS application origin.
6. Run `npm run db:migrate:remote`, then `npm run deploy`.

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
