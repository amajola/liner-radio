import { eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { radioRooms } from "../db/schema";
import type { Room } from "../lib/radio/model";
import { createAuth } from "./auth";
import type { Env } from "./env";
import type { ActionResult } from "./room-channel";
import { RequestFailure, type ApiHandler } from "./http";
import { handleTrackRequest } from "./tracks";
import { handleMusicCatalogRequest } from "./music-catalog";
import { handleProfileRequest } from "./profile";

type Identity = { readonly id: string; readonly name: string; readonly image?: string | null };

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function fail(message: string, status = 400): never {
  throw new RequestFailure({ message, status });
}

async function identity(request: Request, env: Env): Promise<Identity> {
  const session = await createAuth(request, env).api.getSession({
    headers: request.headers,
  });
  if (!session) fail("Sign in to join a room.", 401);
  return {
    id: session.user.id,
    name: session.user.name.slice(0, 80),
    image: session.user.image,
  };
}

function roomChannel(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

function unwrap(result: ActionResult, user: Identity) {
  if (!result.ok) fail(result.message, result.status);
  return json({ room: result.room, user, serverTime: result.serverTime });
}

async function listOrReadRoom(request: Request, env: Env) {
  const user = await identity(request, env);
  const code = new URL(request.url).searchParams.get("room");

  if (!code) {
    const rows = await getDb(env.DB)
      .select({ id: radioRooms.id, state: radioRooms.state })
      .from(radioRooms)
      .where(eq(radioRooms.owner, user.id))
      .limit(20);
    return json({
      user,
      rooms: rows.map((row) => ({
        id: row.id,
        name: (JSON.parse(row.state) as Room).name,
      })),
    });
  }

  const normalized = code.toUpperCase();
  const result = await roomChannel(env, normalized).snapshot(normalized, user.id);
  return unwrap(result, user);
}

async function mutateRoom(request: Request, env: Env) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }
  if (Number(request.headers.get("content-length") || 0) > 12_000) {
    fail("Request too large.", 413);
  }

  const text = await request.text();
  if (text.length > 12_000) fail("Request too large.", 413);

  let action: Record<string, unknown>;
  try {
    action = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail("Request body must be valid JSON.");
  }

  const user = await identity(request, env);

  if (action.type === "create") {
    const db = getDb(env.DB);
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(radioRooms)
      .where(eq(radioRooms.owner, user.id));
    if (Number(count) >= 10) fail("You can host up to 10 rooms.");

    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
    const room: Room = {
      id,
      name: String(action.name || "The listening room").slice(0, 70),
      members: [{ ...user, role: "host", canRequest: true }],
      requests: [],
      queue: [],
      current: null,
      startedAt: null,
      offset: 0,
      playing: false,
      requestsOpen: true,
      volume: 0.8,
      ducked: false,
      crossfadeSeconds: 4,
      revision: 0,
    };
    await db.insert(radioRooms).values({
      id,
      owner: user.id,
      state: JSON.stringify(room),
    });
    return json({ room, user, serverTime: Date.now() });
  }

  const code = String(action.room || "").toUpperCase();
  if (!code) fail("Choose a room first.");

  // Closing is not a room mutation but the end of the room, so it bypasses the
  // revision check: there is no later state for a stale client to conflict with.
  if (action.type === "close") {
    const reason =
      action.reason === "left"
        ? "The host left, so this room has closed."
        : "The host closed this room.";
    const closed = await roomChannel(env, code).close(code, user.id, reason);
    if (!closed.ok) fail(closed.message, closed.status);
    return json({ closed: true, roomId: code, user, serverTime: closed.serverTime });
  }

  const result = await roomChannel(env, code).act(code, user, action);
  return unwrap(result, user);
}

/**
 * WebSocket upgrades bypass the Effect router: a 101 response carries a live
 * socket that cannot survive being rebuilt from a web Response.
 */
export async function handleRoomSocket(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected a WebSocket upgrade.", { status: 426 });
  }
  // Browsers do not apply CORS to WebSockets, so the cookie-authenticated
  // handshake has to reject foreign origins itself.
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return new Response("Request origin rejected.", { status: 403 });
  }

  const session = await createAuth(request, env).api.getSession({
    headers: request.headers,
  });
  if (!session) return new Response("Sign in to join a room.", { status: 401 });

  const code = (url.searchParams.get("room") || "").toUpperCase();
  if (!code) return new Response("Choose a room first.", { status: 400 });

  const target = new URL("https://room.internal/connect");
  target.searchParams.set("room", code);
  target.searchParams.set("uid", session.user.id);

  return roomChannel(env, code).fetch(
    new Request(target, { headers: request.headers }),
  );
}

export function createApiHandler(env: Env): ApiHandler {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/")) {
      return createAuth(request, env).handler(request);
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok" });
    }
    if (url.pathname === "/api/account/providers" && request.method === "GET") {
      return json({
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      });
    }
    if (url.pathname === "/api/radio" && request.method === "GET") {
      return listOrReadRoom(request, env);
    }
    if (url.pathname === "/api/radio" && request.method === "POST") {
      return mutateRoom(request, env);
    }
    const profileResponse = await handleProfileRequest(request, env);
    if (profileResponse) return profileResponse;
    const catalogResponse = await handleMusicCatalogRequest(request, env);
    if (catalogResponse) return catalogResponse;
    const trackResponse = await handleTrackRequest(request, env);
    if (trackResponse) return trackResponse;
    return json({ error: "Not found." }, 404);
  };
}
