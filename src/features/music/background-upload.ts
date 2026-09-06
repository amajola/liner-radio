import type { QueryClient } from "@tanstack/react-query";
import { apiRequest, postJson } from "../../shared/http";
import { useUiStore } from "../../stores/ui-store";
import type { EditableTrackMetadata } from "./embedded-metadata";
import { musicKeys, type MusicAlbum } from "./queries";
import { createUploadJob, useUploadStore } from "./upload-store";
import { uploadTrackFile } from "./use-upload-track";

export type QueuedTrack = EditableTrackMetadata & { file: File };

const metadataFor = (item: QueuedTrack, albumId: string | null) => ({
  albumId,
  genre: item.genre || null,
  year: item.year,
  trackNumber: item.trackNumber,
  discNumber: item.discNumber,
  artworkUrl: item.artworkUrl,
  musicBrainzId: item.musicBrainzId,
  metadataSource: item.metadataSource,
});

/** Runs independently of the intake modal, with two network lanes at most. */
export async function runBackgroundUploads(
  items: QueuedTrack[],
  ownerId: string,
  queryClient: QueryClient,
) {
  const store = useUploadStore.getState();
  const albums = new Map<string, Promise<MusicAlbum>>();
  const jobs = items.map((item) => {
    const job = createUploadJob({ ownerId, fileName: item.file.name, title: item.title, artist: item.artist });
    store.add(job);
    return { item, job };
  });

  const albumFor = (item: QueuedTrack) => {
    if (!item.album.trim()) return Promise.resolve<MusicAlbum | null>(null);
    const key = `${item.album.trim().toLowerCase()}\u0000${(item.albumArtist || item.artist).trim().toLowerCase()}`;
    let request = albums.get(key);
    if (!request) {
      request = postJson<{ album: MusicAlbum }>("/api/music/albums", {
        title: item.album,
        albumArtist: item.albumArtist || item.artist,
        genre: item.genre || null,
        year: item.year,
        artworkUrl: item.artworkUrl,
      }).then((response) => response.album);
      albums.set(key, request);
    }
    return request;
  };

  let cursor = 0;
  const worker = async () => {
    while (cursor < jobs.length) {
      const { item, job } = jobs[cursor++];
      try {
        store.update(job.id, { status: "uploading", progress: 0 });
        const album = await albumFor(item);
        const track = await uploadTrackFile(
          { ownerId, title: item.title, artist: item.artist, duration: item.duration, file: item.file, rightsConfirmed: true },
          (progress) => useUploadStore.getState().update(job.id, { progress }),
          job.controller.signal,
        );
        store.update(job.id, { status: "saving", progress: 1 });
        await apiRequest<{ updated: true }>(`/api/music/tracks/${track.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(metadataFor(item, album?.id || null)),
          signal: job.controller.signal,
        });
        store.update(job.id, { status: "complete", progress: 1 });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: musicKeys.library(ownerId), exact: true }),
          queryClient.invalidateQueries({ queryKey: musicKeys.catalog(ownerId), exact: true }),
        ]);
      } catch (cause) {
        const cancelled = job.controller.signal.aborted;
        store.update(job.id, {
          status: cancelled ? "cancelled" : "error",
          error: cancelled ? undefined : cause instanceof Error ? cause.message : "Upload failed.",
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(2, jobs.length) }, () => worker()));
  const failed = useUploadStore.getState().jobs.filter((job) => jobs.some((entry) => entry.job.id === job.id) && job.status === "error");
  const notices = useUiStore.getState();
  if (failed.length) notices.showError(`${failed.length} upload${failed.length === 1 ? "" : "s"} need attention.`);
  else notices.showNotice(`${items.length} track${items.length === 1 ? "" : "s"} added to your library.`);
}
