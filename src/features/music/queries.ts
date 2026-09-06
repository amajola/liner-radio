import { queryOptions } from "@tanstack/react-query";
import type { Track } from "../../../lib/radio/model";
import { apiRequest } from "../../shared/http";

export type TrackLibrary = { ownerId: string; tracks: Track[] };
export type TrackPlaybackGrant = { url: string; expiresAt: number };
export type MusicAlbum = {
  id: string;
  title: string;
  albumArtist: string;
  genre: string | null;
  year: number | null;
  artworkUrl: string | null;
  musicBrainzId: string | null;
  trackCount: number;
};
export type MusicCatalog = {
  ownerId: string;
  tracks: Track[];
  albums: MusicAlbum[];
};
export type MetadataResult = {
  id: string;
  score: number;
  title: string;
  artist: string;
  album: string | null;
  albumArtist: string | null;
  genre: string | null;
  year: number | null;
  duration: number | null;
  artworkUrl: string | null;
  releaseId: string | null;
};

// Refresh well before the six-hour media ticket expires. Even a four-hour
// programme item can then keep requesting byte ranges until it finishes.
const playbackGrantFreshFor = 20 * 60 * 1_000;
const playbackGrantCacheFor = 6 * 60 * 60 * 1_000;

export const musicKeys = {
  all: ["music"] as const,
  library: (ownerId: string) => ["music", "uploaded-library", ownerId] as const,
  catalog: (ownerId: string) => ["music", "catalog", ownerId] as const,
  metadata: (title: string, artist: string) =>
    ["music", "metadata", title, artist] as const,
  playback: (trackId: string) => ["music", "playback-grant", trackId] as const,
};

export function trackLibraryQueryOptions(ownerId: string) {
  return queryOptions({
    queryKey: musicKeys.library(ownerId),
    queryFn: () =>
      apiRequest<TrackLibrary>(`/api/tracks?owner=${encodeURIComponent(ownerId)}`),
    enabled: Boolean(ownerId),
    staleTime: 30_000,
  });
}

export function musicCatalogQueryOptions(ownerId: string) {
  return queryOptions({
    queryKey: musicKeys.catalog(ownerId),
    queryFn: () =>
      apiRequest<MusicCatalog>(`/api/music/catalog?owner=${encodeURIComponent(ownerId)}`),
    enabled: Boolean(ownerId),
    staleTime: 30_000,
  });
}

export function metadataSearchQueryOptions(title: string, artist: string) {
  const params = new URLSearchParams({ title: title.trim(), artist: artist.trim() });
  return queryOptions({
    queryKey: musicKeys.metadata(title.trim(), artist.trim()),
    queryFn: () => apiRequest<{ results: MetadataResult[] }>(`/api/music/metadata/search?${params}`),
    enabled: Boolean(title.trim() || artist.trim()),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

export function trackPlaybackQueryOptions(trackId: string) {
  return queryOptions({
    queryKey: musicKeys.playback(trackId),
    queryFn: () =>
      apiRequest<TrackPlaybackGrant>(
        `/api/tracks/${encodeURIComponent(trackId)}/playback`,
      ),
    enabled: Boolean(trackId),
    staleTime: playbackGrantFreshFor,
    gcTime: playbackGrantCacheFor,
    retry: 1,
  });
}
