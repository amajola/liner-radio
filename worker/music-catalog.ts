import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { audioTracks, musicAlbums, trackMetadata } from "../db/schema";
import type { Track } from "../lib/radio/model";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { RequestFailure } from "./http";

type Identity = { readonly id: string };

type MusicBrainzRecording = {
  id?: string;
  score?: number;
  title?: string;
  length?: number;
  "first-release-date"?: string;
  "artist-credit"?: Array<{ name?: string }>;
  releases?: Array<{
    id?: string;
    title?: string;
    date?: string;
    "artist-credit"?: Array<{ name?: string }>;
  }>;
  tags?: Array<{ name?: string; count?: number }>;
};

function fail(message: string, status = 400): never {
  throw new RequestFailure({ message, status });
}

async function identity(request: Request, env: Env): Promise<Identity> {
  const session = await createAuth(request, env).api.getSession({ headers: request.headers });
  if (!session) fail("Sign in to use the music library.", 401);
  return { id: session.user.id };
}

function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    fail("Request origin rejected.", 403);
  }
}

async function jsonBody(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 20_000) fail("Request too large.", 413);
  const text = await request.text();
  if (text.length > 20_000) fail("Request too large.", 413);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail("Request body must be valid JSON.");
  }
}

function optionalText(value: unknown, max = 180): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length > max) fail(`Keep metadata under ${max} characters.`);
  return text;
}

function optionalInteger(value: unknown, minimum: number, maximum: number): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    fail(`Choose a number between ${minimum} and ${maximum}.`);
  }
  return number;
}

function optionalArtwork(value: unknown): string | null {
  const text = optionalText(value, 500);
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return fail("Artwork must use a valid HTTPS address.");
  }
  if (url.protocol !== "https:") fail("Artwork must use a valid HTTPS address.");
  return url.toString();
}

function joinArtist(credit?: Array<{ name?: string }>) {
  return credit?.map((item) => item.name).filter(Boolean).join(", ") || "Unknown artist";
}

function asTrack(row: {
  id: string;
  title: string;
  artist: string;
  duration: number;
  bytes: number;
  albumId: string | null;
  album: string | null;
  albumArtist: string | null;
  albumGenre: string | null;
  trackGenre: string | null;
  albumYear: number | null;
  trackYear: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  albumArtwork: string | null;
  trackArtwork: string | null;
  metadataSource: string | null;
}): Track {
  const artworkUrl = row.trackArtwork || row.albumArtwork;
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    duration: row.duration,
    bytes: row.bytes,
    source: "upload",
    url: `/api/tracks/${row.id}/audio`,
    albumId: row.albumId,
    album: row.album,
    albumArtist: row.albumArtist,
    genre: row.trackGenre || row.albumGenre,
    year: row.trackYear || row.albumYear,
    trackNumber: row.trackNumber,
    discNumber: row.discNumber,
    artworkUrl,
    art: artworkUrl || undefined,
    metadataSource:
      row.metadataSource === "musicbrainz" || row.metadataSource === "embedded"
        ? row.metadataSource
        : "manual",
  };
}

async function listCatalog(request: Request, env: Env) {
  const user = await identity(request, env);
  const ownerId = new URL(request.url).searchParams.get("owner") || user.id;
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) fail("Invalid library owner.");

  const db = getDb(env.DB);
  const [trackRows, albumRows] = await Promise.all([
    db
      .select({
        id: audioTracks.id,
        title: audioTracks.title,
        artist: audioTracks.artist,
        duration: audioTracks.duration,
        bytes: audioTracks.bytes,
        albumId: trackMetadata.albumId,
        album: musicAlbums.title,
        albumArtist: musicAlbums.albumArtist,
        albumGenre: musicAlbums.genre,
        trackGenre: trackMetadata.genre,
        albumYear: musicAlbums.year,
        trackYear: trackMetadata.year,
        trackNumber: trackMetadata.trackNumber,
        discNumber: trackMetadata.discNumber,
        albumArtwork: musicAlbums.artworkUrl,
        trackArtwork: trackMetadata.artworkUrl,
        metadataSource: trackMetadata.metadataSource,
      })
      .from(audioTracks)
      .leftJoin(trackMetadata, eq(trackMetadata.trackId, audioTracks.id))
      .leftJoin(musicAlbums, eq(musicAlbums.id, trackMetadata.albumId))
      .where(eq(audioTracks.owner, ownerId))
      .orderBy(desc(audioTracks.createdAt))
      .limit(500),
    db
      .select({
        id: musicAlbums.id,
        title: musicAlbums.title,
        albumArtist: musicAlbums.albumArtist,
        genre: musicAlbums.genre,
        year: musicAlbums.year,
        artworkUrl: musicAlbums.artworkUrl,
        musicBrainzId: musicAlbums.musicBrainzId,
      })
      .from(musicAlbums)
      .where(eq(musicAlbums.owner, ownerId))
      .orderBy(desc(musicAlbums.createdAt))
      .limit(200),
  ]);

  const tracks = trackRows.map(asTrack);
  const counts = new Map<string, number>();
  for (const track of tracks) {
    if (track.albumId) counts.set(track.albumId, (counts.get(track.albumId) || 0) + 1);
  }
  const albums = albumRows.map((album) => ({
    ...album,
    trackCount: counts.get(album.id) || 0,
  }));

  return Response.json(
    { ownerId, tracks, albums },
    { headers: { "Cache-Control": "no-store" } },
  );
}

async function createAlbum(request: Request, env: Env) {
  assertSameOrigin(request);
  const user = await identity(request, env);
  const body = await jsonBody(request);
  const title = optionalText(body.title);
  const albumArtist = optionalText(body.albumArtist);
  if (!title) fail("Enter an album title.");
  if (!albumArtist) fail("Enter an album artist.");

  const db = getDb(env.DB);
  const [existing] = await db
    .select({
      id: musicAlbums.id,
      title: musicAlbums.title,
      albumArtist: musicAlbums.albumArtist,
      genre: musicAlbums.genre,
      year: musicAlbums.year,
      artworkUrl: musicAlbums.artworkUrl,
      musicBrainzId: musicAlbums.musicBrainzId,
    })
    .from(musicAlbums)
    .where(and(eq(musicAlbums.owner, user.id), eq(musicAlbums.title, title), eq(musicAlbums.albumArtist, albumArtist)))
    .limit(1);
  if (existing) return Response.json({ album: { ...existing, trackCount: 0 } });

  const album = {
    id: crypto.randomUUID().replaceAll("-", ""),
    owner: user.id,
    title,
    albumArtist,
    genre: optionalText(body.genre, 80),
    year: optionalInteger(body.year, 1000, 3000),
    artworkUrl: optionalArtwork(body.artworkUrl),
    musicBrainzId: optionalText(body.musicBrainzId, 60),
    createdAt: new Date(),
  };
  await db.insert(musicAlbums).values(album);
  return Response.json({ album: { ...album, createdAt: album.createdAt.getTime(), trackCount: 0 } }, { status: 201 });
}

async function updateTrackMetadata(request: Request, env: Env, trackId: string) {
  assertSameOrigin(request);
  const user = await identity(request, env);
  const body = await jsonBody(request);
  const db = getDb(env.DB);
  const [ownedTrack] = await db
    .select({ id: audioTracks.id })
    .from(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.owner, user.id)))
    .limit(1);
  if (!ownedTrack) fail("Track not found.", 404);

  const albumId = optionalText(body.albumId, 32);
  if (albumId) {
    const [ownedAlbum] = await db
      .select({ id: musicAlbums.id })
      .from(musicAlbums)
      .where(and(eq(musicAlbums.id, albumId), eq(musicAlbums.owner, user.id)))
      .limit(1);
    if (!ownedAlbum) fail("Album not found.", 404);
  }

  const values = {
    trackId,
    owner: user.id,
    albumId,
    genre: optionalText(body.genre, 80),
    year: optionalInteger(body.year, 1000, 3000),
    trackNumber: optionalInteger(body.trackNumber, 1, 999),
    discNumber: optionalInteger(body.discNumber, 1, 99),
    artworkUrl: optionalArtwork(body.artworkUrl),
    musicBrainzId: optionalText(body.musicBrainzId, 60),
    metadataSource:
      body.metadataSource === "embedded" || body.metadataSource === "musicbrainz"
        ? body.metadataSource
        : "manual",
    updatedAt: new Date(),
  } as const;
  const { trackId: _trackId, ...updates } = values;

  await db
    .insert(trackMetadata)
    .values(values)
    .onConflictDoUpdate({
      target: trackMetadata.trackId,
      set: updates,
    });
  return Response.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
}

async function deleteTrack(request: Request, env: Env, trackId: string) {
  assertSameOrigin(request);
  const user = await identity(request, env);
  const db = getDb(env.DB);
  const [track] = await db
    .select({ objectKey: audioTracks.objectKey })
    .from(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.owner, user.id)))
    .limit(1);
  if (!track) fail("Track not found.", 404);
  await env.TRACKS.delete(track.objectKey);
  await db.delete(audioTracks).where(and(eq(audioTracks.id, trackId), eq(audioTracks.owner, user.id)));
  return new Response(null, { status: 204 });
}

async function deleteAlbum(request: Request, env: Env, albumId: string) {
  assertSameOrigin(request);
  const user = await identity(request, env);
  await getDb(env.DB)
    .delete(musicAlbums)
    .where(and(eq(musicAlbums.id, albumId), eq(musicAlbums.owner, user.id)));
  return new Response(null, { status: 204 });
}

async function searchMetadata(request: Request, env: Env) {
  await identity(request, env);
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") || "").trim().slice(0, 180);
  const artist = (url.searchParams.get("artist") || "").trim().slice(0, 180);
  const plain = (url.searchParams.get("q") || "").trim().slice(0, 240);
  if (!title && !artist && plain.length < 2) fail("Enter a title or artist to search.");

  const query = plain || [title && `recording:\"${title.replaceAll('"', "")}\"`, artist && `artist:\"${artist.replaceAll('"', "")}\"`]
    .filter(Boolean)
    .join(" AND ");
  const upstream = new URL("https://musicbrainz.org/ws/2/recording/");
  upstream.searchParams.set("query", query);
  upstream.searchParams.set("fmt", "json");
  upstream.searchParams.set("limit", "8");

  const response = await fetch(upstream, {
    headers: {
      Accept: "application/json",
      "User-Agent": "LinerRadio/0.2 (https://liner.radio)",
    },
  });
  if (!response.ok) fail("MusicBrainz is unavailable right now. You can keep editing manually.", 502);
  const payload = (await response.json()) as { recordings?: MusicBrainzRecording[] };
  const results = (payload.recordings || []).map((recording) => {
    const release = recording.releases?.[0];
    const yearText = recording["first-release-date"] || release?.date || "";
    const genre = recording.tags?.sort((a, b) => (b.count || 0) - (a.count || 0))[0]?.name;
    return {
      id: recording.id || "",
      score: recording.score || 0,
      title: recording.title || "Untitled",
      artist: joinArtist(recording["artist-credit"]),
      album: release?.title || null,
      albumArtist: release ? joinArtist(release["artist-credit"]) : null,
      year: /^\d{4}/.test(yearText) ? Number(yearText.slice(0, 4)) : null,
      duration: recording.length ? Math.round(recording.length / 1_000) : null,
      genre: genre || null,
      artworkUrl: release?.id
        ? `https://coverartarchive.org/release/${release.id}/front-250`
        : null,
      releaseId: release?.id || null,
    };
  });
  return Response.json({ results }, { headers: { "Cache-Control": "private, max-age=300" } });
}

export async function handleMusicCatalogRequest(request: Request, env: Env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/music/catalog" && request.method === "GET") {
    return listCatalog(request, env);
  }
  if (url.pathname === "/api/music/albums" && request.method === "POST") {
    return createAlbum(request, env);
  }
  if (url.pathname === "/api/music/metadata/search" && request.method === "GET") {
    return searchMetadata(request, env);
  }
  const trackMatch = url.pathname.match(/^\/api\/music\/tracks\/([a-f0-9]{32})$/);
  if (trackMatch && request.method === "PATCH") {
    return updateTrackMetadata(request, env, trackMatch[1]);
  }
  if (trackMatch && request.method === "DELETE") {
    return deleteTrack(request, env, trackMatch[1]);
  }
  const albumMatch = url.pathname.match(/^\/api\/music\/albums\/([a-f0-9]{32})$/);
  if (albumMatch && request.method === "DELETE") {
    return deleteAlbum(request, env, albumMatch[1]);
  }
  return null;
}
