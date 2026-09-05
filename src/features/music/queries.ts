import { queryOptions } from "@tanstack/react-query";
import type { Track } from "../../../lib/radio/model";
import { apiRequest } from "../../shared/http";

export type TrackLibrary = { ownerId: string; tracks: Track[] };
export type TrackPlaybackGrant = { url: string; expiresAt: number };

// Refresh well before the six-hour media ticket expires. Even a four-hour
// programme item can then keep requesting byte ranges until it finishes.
const playbackGrantFreshFor = 20 * 60 * 1_000;
const playbackGrantCacheFor = 6 * 60 * 60 * 1_000;

export const musicKeys = {
  all: ["music"] as const,
  library: (ownerId: string) => ["music", "uploaded-library", ownerId] as const,
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
