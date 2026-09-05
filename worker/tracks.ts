import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { audioTracks } from "../db/schema";
import {
  createMediaTicket,
  MEDIA_TICKET_TTL_MS,
  verifyMediaTicket,
} from "../lib/http/media-ticket";
import { parseRangeHeader } from "../lib/http/range";
import type { Track } from "../lib/radio/model";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { RequestFailure } from "./http";

const maximumFileBytes = 30 * 1024 * 1024;
const immutableCacheSeconds = 365 * 24 * 60 * 60;
const audioTypes = new Set([
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
]);

type Identity = { readonly id: string; readonly name: string };

function fail(message: string, status = 400): never {
  throw new RequestFailure({ message, status });
}

async function identity(request: Request, env: Env): Promise<Identity> {
  const session = await createAuth(request, env).api.getSession({ headers: request.headers });
  if (!session) fail("Sign in to use the music library.", 401);
  return { id: session.user.id, name: session.user.name.slice(0, 80) };
}

function asTrack(row: {
  id: string;
  title: string;
  artist: string;
  duration: number;
}): Track {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    duration: row.duration,
    source: "upload",
    url: `/api/tracks/${row.id}/audio`,
  };
}

export async function findUploadedTrack(
  env: Env,
  trackId: string,
  ownerId: string,
): Promise<Track> {
  const [row] = await getDb(env.DB)
    .select({
      id: audioTracks.id,
      title: audioTracks.title,
      artist: audioTracks.artist,
      duration: audioTracks.duration,
    })
    .from(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.owner, ownerId)))
    .limit(1);
  if (!row) fail("That track is no longer in the host’s library.", 404);
  return asTrack(row);
}

async function listTracks(request: Request, env: Env) {
  const user = await identity(request, env);
  const ownerId = new URL(request.url).searchParams.get("owner") || user.id;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) fail("Invalid library owner.");

  const rows = await getDb(env.DB)
    .select({
      id: audioTracks.id,
      title: audioTracks.title,
      artist: audioTracks.artist,
      duration: audioTracks.duration,
    })
    .from(audioTracks)
    .where(eq(audioTracks.owner, ownerId))
    .orderBy(desc(audioTracks.createdAt))
    .limit(200);

  return Response.json(
    { ownerId, tracks: rows.map(asTrack) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function uploadTrack(request: Request, env: Env) {
  const user = await identity(request, env);
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maximumFileBytes + 100_000) fail("Audio files can be up to 30 MB.", 413);

  const [{ count, bytes }] = await getDb(env.DB)
    .select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${audioTracks.bytes}), 0)`,
    })
    .from(audioTracks)
    .where(eq(audioTracks.owner, user.id));
  if (Number(count) >= 200) fail("Your library can contain up to 200 tracks.");

  const form = await request.formData();
  const file = form.get("file");
  const title = String(form.get("title") || "").trim();
  const artist = String(form.get("artist") || "").trim();
  const duration = Math.round(Number(form.get("duration")));
  const rightsConfirmed = form.get("rightsConfirmed") === "true";

  if (!(file instanceof File) || file.size === 0) fail("Choose an audio file.");
  if (file.size > maximumFileBytes) fail("Audio files can be up to 30 MB.", 413);
  if (Number(bytes) + file.size > 1024 * 1024 * 1024) {
    fail("Your uploaded library can use up to 1 GB.");
  }
  if (!audioTypes.has(file.type)) fail("Upload an MP3, M4A, WAV, OGG, or WebM audio file.");
  if (!title || title.length > 180) fail("Enter a track title under 180 characters.");
  if (!artist || artist.length > 180) fail("Enter an artist name under 180 characters.");
  if (!Number.isFinite(duration) || duration < 1 || duration > 14_400) {
    fail("The audio duration must be between one second and four hours.");
  }
  if (!rightsConfirmed) fail("Confirm that you have permission to stream this audio.");

  const id = crypto.randomUUID().replaceAll("-", "");
  const objectKey = `tracks/${user.id}/${id}`;
  await env.TRACKS.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "private, max-age=3600" },
    customMetadata: { ownerId: user.id, originalName: file.name.slice(0, 180) },
  });

  try {
    await getDb(env.DB).insert(audioTracks).values({
      id,
      owner: user.id,
      title,
      artist,
      objectKey,
      mimeType: file.type,
      bytes: file.size,
      duration,
      createdAt: new Date(),
    });
  } catch (cause) {
    await env.TRACKS.delete(objectKey);
    throw cause;
  }

  return Response.json(
    { track: asTrack({ id, title, artist, duration }) },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

async function createPlaybackGrant(request: Request, env: Env, trackId: string) {
  const started = performance.now();
  await identity(request, env);
  const authenticated = performance.now();

  const [row] = await getDb(env.DB)
    .select({
      objectKey: audioTracks.objectKey,
      bytes: audioTracks.bytes,
      mimeType: audioTracks.mimeType,
    })
    .from(audioTracks)
    .where(eq(audioTracks.id, trackId))
    .limit(1);
  if (!row) fail("Track not found.", 404);

  const expiresAt = Date.now() + MEDIA_TICKET_TTL_MS;
  const token = await createMediaTicket(
    {
      version: 1,
      trackId,
      objectKey: row.objectKey,
      bytes: row.bytes,
      mimeType: row.mimeType,
      expiresAt,
    },
    env.BETTER_AUTH_SECRET,
  );
  const url = new URL(`/api/tracks/${trackId}/audio`, request.url);
  url.searchParams.set("ticket", token);

  return Response.json(
    { url: `${url.pathname}${url.search}`, expiresAt },
    {
      headers: {
        "Cache-Control": "private, no-store",
        "Server-Timing": `auth;dur=${(authenticated - started).toFixed(1)}, db;dur=${(
          performance.now() - authenticated
        ).toFixed(1)}`,
      },
    },
  );
}

function cachedMediaRequest(request: Request, trackId: string, range?: string): Request {
  const url = new URL(`/__liner-radio-media-cache/v1/${trackId}`, request.url);
  const headers = new Headers();
  if (range) headers.set("Range", range);
  return new Request(url, { method: "GET", headers });
}

function mediaHeaders(mimeType: string, size: number) {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": `private, max-age=${MEDIA_TICKET_TTL_MS / 1_000}, immutable`,
    "Content-Length": String(size),
    "Content-Type": mimeType,
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
  });
}

function withMediaTiming(
  response: Response,
  method: string,
  ticketDuration: number,
  cacheStatus: "HIT" | "MISS",
) {
  const headers = new Headers(response.headers);
  headers.set("X-Media-Cache", cacheStatus);
  headers.set(
    "Server-Timing",
    `ticket;dur=${ticketDuration.toFixed(1)}, cache;desc=${cacheStatus}`,
  );
  return new Response(method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function streamTrack(
  request: Request,
  env: Env,
  trackId: string,
  context?: ExecutionContext,
) {
  const started = performance.now();
  const token = new URL(request.url).searchParams.get("ticket") || "";
  const ticket = await verifyMediaTicket(token, trackId, env.BETTER_AUTH_SECRET);
  if (!ticket) fail("This playback link has expired. Reconnect to the room.", 401);
  const ticketDuration = performance.now() - started;

  // A 206 is only a legal answer to a request that asked for a range. Safari
  // opens media with a plain GET and will not play a partial response it never
  // requested, so the unranged path has to stay a clean 200 with a length.
  const range = request.headers.get("range");
  const parsed = parseRangeHeader(range, ticket.bytes);

  if (parsed === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": `bytes */${ticket.bytes}`,
        "Cache-Control": "no-store",
        "Server-Timing": `ticket;dur=${ticketDuration.toFixed(1)}`,
      },
    });
  }

  // The token is checked before the token-free cache key is used. This lets all
  // authorized listeners share one immutable object without making its URL
  // public or repeating Better Auth and D1 work for every browser byte range.
  const cache = (caches as CacheStorage & { readonly default: Cache }).default;
  const cached = await cache
    .match(cachedMediaRequest(request, trackId, range || undefined))
    .catch(() => undefined);
  if (cached) return withMediaTiming(cached, request.method, ticketDuration, "HIT");

  if (request.method === "HEAD") {
    const object = await env.TRACKS.head(ticket.objectKey);
    if (!object) fail("Audio file not found.", 404);
    const headers = mediaHeaders(ticket.mimeType, ticket.bytes);
    headers.set("ETag", object.httpEtag);
    return withMediaTiming(new Response(null, { status: 200, headers }), request.method, ticketDuration, "MISS");
  }

  const object = parsed
    ? await env.TRACKS.get(ticket.objectKey, {
        range: { offset: parsed.start, length: parsed.length },
      })
    : await env.TRACKS.get(ticket.objectKey);
  if (!object) fail("Audio file not found.", 404);

  const headers = mediaHeaders(ticket.mimeType, ticket.bytes);
  headers.set("ETag", object.httpEtag);

  const isWholeObject =
    parsed === null || (parsed.start === 0 && parsed.length === ticket.bytes);
  let body: ReadableStream | null = object.body;

  if (isWholeObject && context) {
    const cacheHeaders = new Headers(headers);
    cacheHeaders.set("Cache-Control", `public, max-age=${immutableCacheSeconds}, immutable`);
    const cacheable = new Response(body, { status: 200, headers: cacheHeaders });
    context.waitUntil(
      cache
        .put(cachedMediaRequest(request, trackId), cacheable.clone())
        .catch(() => undefined),
    );
    body = cacheable.body;
  }

  if (parsed) {
    const end = Math.min(parsed.start + parsed.length, ticket.bytes) - 1;
    headers.set("Content-Range", `bytes ${parsed.start}-${end}/${ticket.bytes}`);
    headers.set("Content-Length", String(end - parsed.start + 1));
    return withMediaTiming(
      new Response(body, { status: 206, headers }),
      request.method,
      ticketDuration,
      "MISS",
    );
  }

  return withMediaTiming(
    new Response(body, { status: 200, headers }),
    request.method,
    ticketDuration,
    "MISS",
  );
}

export async function handleTrackRequest(
  request: Request,
  env: Env,
  context?: ExecutionContext,
) {
  const url = new URL(request.url);
  if (url.pathname === "/api/tracks" && request.method === "GET") {
    return listTracks(request, env);
  }
  if (url.pathname === "/api/tracks" && request.method === "POST") {
    return uploadTrack(request, env);
  }
  const playbackMatch = url.pathname.match(/^\/api\/tracks\/([a-f0-9]{32})\/playback$/);
  if (playbackMatch && request.method === "GET") {
    return createPlaybackGrant(request, env, playbackMatch[1]);
  }
  const match = url.pathname.match(/^\/api\/tracks\/([a-f0-9]{32})\/audio$/);
  if (match && (request.method === "GET" || request.method === "HEAD")) {
    return streamTrack(request, env, match[1], context);
  }
  return null;
}
