# Start here

Run `bun install`, sign in once with `bun alchemy login`, then run `bun run dev`
and open <http://localhost:5173>. Alchemy creates the local D1, R2, Durable
Object, migrations, and auth secret automatically.

The current architecture is intentionally independent of any hosted application
builder or third-party identity dispatcher. Better Auth owns user sessions, D1
stores both auth and radio data, and Effect handles the Fetch-compatible HTTP API.

Important source locations:

- `src/` — React SPA and fixed-viewport interface
- `worker/` — Effect HTTP adapter, Better Auth, and API handlers
- `db/` — Drizzle schemas
- `drizzle/` — D1 migrations
- `lib/radio/model.ts` — framework-independent room rules
- `worker/room-channel.ts` — per-room Durable Object, WebSocket fan-out, auto-advance
- `src/features/radio/use-room-channel.ts` — live socket feed and clock sync
- `tests/` — domain, HTTP, and viewport contracts

See `README.md` for environment setup and deployment instructions.
