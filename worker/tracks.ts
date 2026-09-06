import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../db";
import { audioTracks, trackUploads } from "../db/schema";
import { AUDIO_FORMAT_LABEL, resolveAudioType } from "../lib/http/audio-types";
import {
  createMediaTicket,
  MEDIA_TICKET_TTL_MS,
  verifyMediaTicket,
} from "../lib/http/media-ticket";
import { parseRangeHeader } from "../lib/http/range";
import {
  DIRECT_UPLOAD_BYTES,
  expectedPartBytes,
  MAXIMUM_LIBRARY_BYTES,
  MAXIMUM_TRACK_BYTES,
  MAXIMUM_TRACK_COUNT,
  partCountFor,
  UPLOAD_EXPIRY_MS,
  UPLOAD_PART_BYTES,
} from "../lib/http/upload-limits";
import type { Track } from "../lib/radio/model";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { RequestFailure } from "./http";

const immutableCacheSeconds = 365 * 24 * 60 * 60;
/**
 * Above this the whole-object cache write is skipped. `cache.put` is handed a
 * `clone()`, which tees the body and leaves the Worker holding however far
 * apart the cache and the client drain — on a 300 MB track that is the memory
 * limit. Large tracks serve from R2 by range instead, which is what a media
 * element asks for anyway once the file is big.
 */
const maximumCacheableBytes = 24 * 1024 * 1024;
const megabytes = (bytes: number) => Math.round(bytes / (1024 * 1024));
const gigabytes = (bytes: number) => Math.round(bytes / (1024 * 1024 * 1024));

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

function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") || 0) > 12_000) {
    fail("Request too large.", 413);
  }
  const text = await request.text();
  if (text.length > 12_000) fail("Request too large.", 413);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail("Request body must be valid JSON.");
  }
}

type TrackMetadata = {
  readonly title: string;
  readonly artist: string;
  readonly duration: number;
  readonly mimeType: string;
};

/**
 * Shared by both upload paths so a file cannot become admissible simply by
 * being large enough to take the multipart route.
 */
function validateMetadata(input: {
  title: unknown;
  artist: unknown;
  duration: unknown;
  mimeType: unknown;
  fileName: unknown;
  rightsConfirmed: unknown;
}): TrackMetadata {
  const title = String(input.title ?? "").trim();
  const artist = String(input.artist ?? "").trim();
  const duration = Math.round(Number(input.duration));
  const declared = String(input.mimeType ?? "");
  const mimeType = resolveAudioType(declared, String(input.fileName ?? ""));

  if (!mimeType) {
    // Naming the rejected type matters: the browser, not the person choosing
    // the file, is what produced it.
    fail(
      `Upload a ${AUDIO_FORMAT_LABEL} audio file.` +
        (declared ? ` This file was reported as “${declared}”.` : ""),
    );
  }
  if (!title || title.length > 180) fail("Enter a track title under 180 characters.");
  if (!artist || artist.length > 180) fail("Enter an artist name under 180 characters.");
  if (!Number.isFinite(duration) || duration < 1 || duration > 14_400) {
    fail("The audio duration must be between one second and four hours.");
  }
  if (input.rightsConfirmed !== true && input.rightsConfirmed !== "true") {
    fail("Confirm that you have permission to stream this audio.");
  }
  return { title, artist, duration, mimeType };
}

/**
 * Counts bytes already reserved by in-flight multipart uploads as well as
 * committed tracks, so a host cannot open many large uploads at once and land
 * far past the quota when they all complete.
 */
async function assertLibraryHasRoom(env: Env, ownerId: string, incomingBytes: number) {
  const db = getDb(env.DB);
  const [[committed], [pending]] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)`,
        bytes: sql<number>`coalesce(sum(${audioTracks.bytes}), 0)`,
      })
      .from(audioTracks)
      .where(eq(audioTracks.owner, ownerId)),
    db
      .select({ bytes: sql<number>`coalesce(sum(${trackUploads.bytes}), 0)` })
      .from(trackUploads)
      // Only uploads that could still complete count against the quota. An
      // expired reservation is the sweeper's to reclaim, and must not lock a
      // host out of their own library in the meantime.
      .where(
        and(
          eq(trackUploads.owner, ownerId),
          gt(trackUploads.createdAt, new Date(Date.now() - UPLOAD_EXPIRY_MS)),
        ),
      ),
  ]);

  if (Number(committed.count) >= MAXIMUM_TRACK_COUNT) {
    fail(`Your library can contain up to ${MAXIMUM_TRACK_COUNT} tracks.`);
  }
  if (Number(committed.bytes) + Number(pending.bytes) + incomingBytes > MAXIMUM_LIBRARY_BYTES) {
    fail(`Your uploaded library can use up to ${gigabytes(MAXIMUM_LIBRARY_BYTES)} GB.`);
  }
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

/**
 * The single-request path, kept for files small enough that buffering the body
 * is safe. `formData()` materialises the whole upload in Worker memory, so this
 * route is capped well below the Worker's limit and anything larger is sent
 * through the multipart endpoints below.
 */
async function uploadTrack(request: Request, env: Env) {
  const user = await identity(request, env);
  assertSameOrigin(request);

  const tooLarge = `Files over ${megabytes(DIRECT_UPLOAD_BYTES)} MB must use the resumable upload.`;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > DIRECT_UPLOAD_BYTES + 100_000) fail(tooLarge, 413);

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose an audio file.");
  if (file.size > DIRECT_UPLOAD_BYTES) fail(tooLarge, 413);

  const { title, artist, duration, mimeType } = validateMetadata({
    title: form.get("title"),
    artist: form.get("artist"),
    duration: form.get("duration"),
    mimeType: file.type,
    fileName: file.name,
    rightsConfirmed: form.get("rightsConfirmed"),
  });
  await assertLibraryHasRoom(env, user.id, file.size);

  const id = crypto.randomUUID().replaceAll("-", "");
  const objectKey = `tracks/${user.id}/${id}`;
  await env.TRACKS.put(objectKey, file.stream(), {
    httpMetadata: { contentType: mimeType, cacheControl: "private, max-age=3600" },
    customMetadata: { ownerId: user.id, originalName: file.name.slice(0, 180) },
  });

  try {
    await getDb(env.DB).insert(audioTracks).values({
      id,
      owner: user.id,
      title,
      artist,
      objectKey,
      mimeType,
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

type PendingUpload = {
  readonly id: string;
  readonly objectKey: string;
  readonly uploadId: string;
  readonly title: string;
  readonly artist: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly duration: number;
};

async function loadPendingUpload(
  env: Env,
  trackId: string,
  ownerId: string,
): Promise<PendingUpload> {
  const [row] = await getDb(env.DB)
    .select({
      id: trackUploads.id,
      objectKey: trackUploads.objectKey,
      uploadId: trackUploads.uploadId,
      title: trackUploads.title,
      artist: trackUploads.artist,
      mimeType: trackUploads.mimeType,
      bytes: trackUploads.bytes,
      duration: trackUploads.duration,
    })
    .from(trackUploads)
    .where(and(eq(trackUploads.id, trackId), eq(trackUploads.owner, ownerId)))
    .limit(1);
  if (!row) fail("That upload has expired or was already finished.", 404);
  return row;
}

/** Releases both the R2 multipart upload and the row that tracks it. */
async function discardUpload(env: Env, pending: PendingUpload) {
  await env.TRACKS.resumeMultipartUpload(pending.objectKey, pending.uploadId)
    .abort()
    .catch(() => undefined);
  await getDb(env.DB).delete(trackUploads).where(eq(trackUploads.id, pending.id));
}

/**
 * A browser that closes mid-upload leaves an R2 multipart upload holding bytes
 * nobody will ever complete. There is no lifecycle hook here, so the sweep is
 * amortised onto the next upload the same host starts.
 */
/**
 * Small enough that one delete stays well inside D1's bound-parameter limit,
 * and that a single fire cannot run long even when every abort is slow.
 */
const sweepBatchSize = 50;

async function sweepOneBatch(env: Env, cutoff: Date): Promise<number> {
  const stale = await getDb(env.DB)
    .select({
      id: trackUploads.id,
      objectKey: trackUploads.objectKey,
      uploadId: trackUploads.uploadId,
    })
    .from(trackUploads)
    .where(lt(trackUploads.createdAt, cutoff))
    .limit(sweepBatchSize);
  if (!stale.length) return 0;

  // Aborting is what actually releases the parts R2 is holding, but a failure
  // here is not fatal: the upload may already have been aborted or completed.
  // The rows are deleted either way, so an abort that can never succeed cannot
  // wedge the sweep behind the same batch forever.
  for (const row of stale) {
    await env.TRACKS.resumeMultipartUpload(row.objectKey, row.uploadId)
      .abort()
      .catch(() => undefined);
  }
  await getDb(env.DB).delete(trackUploads).where(
    inArray(
      trackUploads.id,
      stale.map((row) => row.id),
    ),
  );
  return stale.length;
}

/**
 * Reclaims uploads that were begun and never finished — a browser closed
 * mid-transfer leaves an R2 multipart upload holding bytes nobody will ever
 * complete. Runs from the Worker's scheduled handler rather than off the back
 * of the next upload, so a host who abandons one and never returns is still
 * cleaned up, and starting an upload no longer pays for the sweep.
 *
 * Batches are drained up to `maximumBatches` so a backlog clears over a few
 * fires instead of one run growing without bound.
 */
export async function sweepAbandonedUploads(env: Env, maximumBatches = 10): Promise<number> {
  const cutoff = new Date(Date.now() - UPLOAD_EXPIRY_MS);
  let swept = 0;
  for (let batch = 0; batch < maximumBatches; batch += 1) {
    const removed = await sweepOneBatch(env, cutoff);
    swept += removed;
    if (removed < sweepBatchSize) break;
  }
  return swept;
}

async function beginUpload(request: Request, env: Env) {
  const user = await identity(request, env);
  assertSameOrigin(request);
  const body = await readJsonBody(request);

  const bytes = Number(body.bytes);
  if (!Number.isSafeInteger(bytes) || bytes <= 0) fail("Provide the file size in bytes.");
  if (bytes > MAXIMUM_TRACK_BYTES) {
    fail(`Audio files can be up to ${megabytes(MAXIMUM_TRACK_BYTES)} MB.`, 413);
  }
  if (bytes <= DIRECT_UPLOAD_BYTES) {
    fail(`Files under ${megabytes(DIRECT_UPLOAD_BYTES)} MB upload in a single request.`);
  }

  const metadata = validateMetadata({
    title: body.title,
    artist: body.artist,
    duration: body.duration,
    mimeType: body.mimeType,
    fileName: body.fileName,
    rightsConfirmed: body.rightsConfirmed,
  });

  await assertLibraryHasRoom(env, user.id, bytes);

  const id = crypto.randomUUID().replaceAll("-", "");
  const objectKey = `tracks/${user.id}/${id}`;
  const upload = await env.TRACKS.createMultipartUpload(objectKey, {
    httpMetadata: { contentType: metadata.mimeType, cacheControl: "private, max-age=3600" },
    customMetadata: { ownerId: user.id },
  });

  try {
    await getDb(env.DB).insert(trackUploads).values({
      id,
      owner: user.id,
      objectKey,
      uploadId: upload.uploadId,
      title: metadata.title,
      artist: metadata.artist,
      mimeType: metadata.mimeType,
      bytes,
      duration: metadata.duration,
      createdAt: new Date(),
    });
  } catch (cause) {
    await upload.abort().catch(() => undefined);
    throw cause;
  }

  return Response.json(
    { trackId: id, partSize: UPLOAD_PART_BYTES, partCount: partCountFor(bytes) },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

async function uploadTrackPart(
  request: Request,
  env: Env,
  trackId: string,
  partNumber: number,
) {
  const user = await identity(request, env);
  assertSameOrigin(request);
  const pending = await loadPendingUpload(env, trackId, user.id);

  const expected = expectedPartBytes(pending.bytes, partNumber);
  if (expected <= 0) fail("That part number is not part of this upload.");

  const body = await request.arrayBuffer();
  // R2 rejects a multipart upload whose non-final parts differ in size, but only
  // at complete() — after every byte has already been spent. Checking each part
  // as it lands turns that into an immediate error on the part that is wrong.
  if (body.byteLength !== expected) {
    fail(`Part ${partNumber} must be exactly ${expected} bytes.`);
  }

  const part = await env.TRACKS.resumeMultipartUpload(
    pending.objectKey,
    pending.uploadId,
  ).uploadPart(partNumber, body);

  return Response.json(
    { partNumber: part.partNumber, etag: part.etag },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function completeUpload(request: Request, env: Env, trackId: string) {
  const user = await identity(request, env);
  assertSameOrigin(request);
  const pending = await loadPendingUpload(env, trackId, user.id);
  const body = await readJsonBody(request);

  const submitted = Array.isArray(body.parts) ? body.parts : fail("Provide the uploaded parts.");
  if (submitted.length !== partCountFor(pending.bytes)) {
    fail("The upload is missing parts. Start it again.");
  }
  const parts = submitted.map((value, index) => {
    const part = value as { partNumber?: unknown; etag?: unknown } | null;
    const partNumber = Number(part?.partNumber);
    const etag = String(part?.etag ?? "");
    if (partNumber !== index + 1 || !etag) {
      fail("The upload parts are out of order. Start it again.");
    }
    return { partNumber, etag };
  });

  let object: R2Object;
  try {
    object = await env.TRACKS.resumeMultipartUpload(
      pending.objectKey,
      pending.uploadId,
    ).complete(parts);
  } catch (cause) {
    await discardUpload(env, pending).catch(() => undefined);
    throw cause;
  }

  // The declared size gated the quota check, so the assembled object has to
  // match it — otherwise a client could reserve 40 MB and store 300.
  if (object.size !== pending.bytes) {
    await env.TRACKS.delete(pending.objectKey).catch(() => undefined);
    await getDb(env.DB).delete(trackUploads).where(eq(trackUploads.id, pending.id));
    fail("The uploaded audio did not match its declared size. Start it again.");
  }

  const db = getDb(env.DB);
  try {
    await db.insert(audioTracks).values({
      id: pending.id,
      owner: user.id,
      title: pending.title,
      artist: pending.artist,
      objectKey: pending.objectKey,
      mimeType: pending.mimeType,
      bytes: pending.bytes,
      duration: pending.duration,
      createdAt: new Date(),
    });
  } catch (cause) {
    await env.TRACKS.delete(pending.objectKey).catch(() => undefined);
    await db.delete(trackUploads).where(eq(trackUploads.id, pending.id));
    throw cause;
  }
  await db.delete(trackUploads).where(eq(trackUploads.id, pending.id));

  return Response.json(
    {
      track: asTrack({
        id: pending.id,
        title: pending.title,
        artist: pending.artist,
        duration: pending.duration,
      }),
    },
    { status: 201, headers: { "Cache-Control": "no-store" } },
  );
}

async function abortUpload(request: Request, env: Env, trackId: string) {
  const user = await identity(request, env);
  assertSameOrigin(request);
  await discardUpload(env, await loadPendingUpload(env, trackId, user.id));
  return Response.json({ aborted: true }, { headers: { "Cache-Control": "no-store" } });
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

  if (isWholeObject && context && ticket.bytes <= maximumCacheableBytes) {
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
  if (url.pathname === "/api/tracks/uploads" && request.method === "POST") {
    return beginUpload(request, env);
  }
  const partMatch = url.pathname.match(
    /^\/api\/tracks\/uploads\/([a-f0-9]{32})\/parts\/(\d{1,5})$/,
  );
  if (partMatch && request.method === "PUT") {
    return uploadTrackPart(request, env, partMatch[1], Number(partMatch[2]));
  }
  const completeMatch = url.pathname.match(
    /^\/api\/tracks\/uploads\/([a-f0-9]{32})\/complete$/,
  );
  if (completeMatch && request.method === "POST") {
    return completeUpload(request, env, completeMatch[1]);
  }
  const abortMatch = url.pathname.match(/^\/api\/tracks\/uploads\/([a-f0-9]{32})$/);
  if (abortMatch && request.method === "DELETE") {
    return abortUpload(request, env, abortMatch[1]);
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
