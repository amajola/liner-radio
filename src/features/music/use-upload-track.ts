import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import {
  DIRECT_UPLOAD_BYTES,
  MAXIMUM_TRACK_BYTES,
} from "../../../lib/http/upload-limits";
import type { Track } from "../../../lib/radio/model";
import { ApiError, apiRequest, postJson } from "../../shared/http";
import { useUiStore } from "../../stores/ui-store";
import { musicKeys } from "./queries";

export type UploadTrackInput = {
  ownerId: string;
  title: string;
  artist: string;
  duration: number;
  file: File;
  rightsConfirmed: boolean;
};

/** The fields that actually travel to the server; `ownerId` only keys the cache. */
type UploadPayload = Omit<UploadTrackInput, "ownerId">;

type BeganUpload = { trackId: string; partSize: number; partCount: number };
type UploadedPart = { partNumber: number; etag: string };

// A part can fail on a flaky link without the upload being lost — R2 still
// holds every part already stored, so only the failed one is sent again.
const PART_ATTEMPTS = 3;

async function sendPart(
  trackId: string,
  partNumber: number,
  body: Blob,
  signal: AbortSignal,
): Promise<UploadedPart> {
  let lastCause: unknown;
  for (let attempt = 1; attempt <= PART_ATTEMPTS; attempt += 1) {
    if (signal.aborted) throw new DOMException("Upload cancelled.", "AbortError");
    try {
      return await apiRequest<UploadedPart>(
        `/api/tracks/uploads/${trackId}/parts/${partNumber}`,
        { method: "PUT", body, signal },
      );
    } catch (cause) {
      // A 4xx means this request was wrong and resending it will be wrong too.
      // Only transient failures are worth another attempt.
      if (cause instanceof ApiError && cause.status < 500) throw cause;
      lastCause = cause;
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastCause;
}

/**
 * Splits the file client-side and streams it through the Worker into an R2
 * multipart upload. Each request stays one part wide, so neither the Worker's
 * request-body cap nor its memory limit scales with the size of the track.
 */
async function uploadInParts(
  input: UploadPayload,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<Track> {
  const begun = await postJson<BeganUpload>("/api/tracks/uploads", {
    title: input.title,
    artist: input.artist,
    duration: input.duration,
    bytes: input.file.size,
    mimeType: input.file.type,
    fileName: input.file.name,
    rightsConfirmed: input.rightsConfirmed,
  });

  try {
    const parts: UploadedPart[] = [];
    for (let index = 0; index < begun.partCount; index += 1) {
      const start = index * begun.partSize;
      const slice = input.file.slice(start, Math.min(start + begun.partSize, input.file.size));
      parts.push(await sendPart(begun.trackId, index + 1, slice, signal));
      onProgress((index + 1) / begun.partCount);
    }
    const { track } = await postJson<{ track: Track }>(
      `/api/tracks/uploads/${begun.trackId}/complete`,
      { parts },
    );
    return track;
  } catch (cause) {
    // Release the R2 multipart upload now rather than leaving its bytes to sit
    // until the server-side sweep notices them a day later.
    await fetch(`/api/tracks/uploads/${begun.trackId}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => undefined);
    throw cause;
  }
}

async function uploadDirectly(input: UploadPayload, signal?: AbortSignal): Promise<Track> {
  const body = new FormData();
  body.set("title", input.title);
  body.set("artist", input.artist);
  body.set("duration", String(input.duration));
  body.set("rightsConfirmed", String(input.rightsConfirmed));
  body.set("file", input.file);
  const { track } = await apiRequest<{ track: Track }>("/api/tracks", {
    method: "POST",
    body,
    signal,
  });
  return track;
}

/** Shared by the one-track form and the background album queue. */
export async function uploadTrackFile(
  input: UploadTrackInput,
  onProgress: (fraction: number) => void = () => undefined,
  signal: AbortSignal = new AbortController().signal,
) {
  if (input.file.size > MAXIMUM_TRACK_BYTES) {
    throw new ApiError(
      `Audio files can be up to ${Math.round(MAXIMUM_TRACK_BYTES / (1024 * 1024))} MB.`,
      413,
    );
  }
  const { ownerId: _ownerId, ...payload } = input;
  if (payload.file.size <= DIRECT_UPLOAD_BYTES) {
    onProgress(0.08);
    const track = await uploadDirectly(payload, signal);
    onProgress(1);
    return track;
  }
  return uploadInParts(payload, onProgress, signal);
}

export function useUploadTrack() {
  const queryClient = useQueryClient();
  const showError = useUiStore((state) => state.showError);
  const showNotice = useUiStore((state) => state.showNotice);
  // Null while a small file uploads in one request: there is nothing meaningful
  // to report between sending it and it being done.
  const [progress, setProgress] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const mutation = useMutation({
    mutationKey: [...musicKeys.all, "upload"],
    mutationFn: async (input: UploadTrackInput) => {
      const controller = new AbortController();
      abort.current = controller;
      setProgress(0);
      return uploadTrackFile(input, setProgress, controller.signal);
    },
    onSettled: () => {
      abort.current = null;
      setProgress(null);
    },
    onSuccess: async (_track, variables) => {
      showNotice("Track uploaded to your library.");
      await queryClient.invalidateQueries({
        queryKey: musicKeys.library(variables.ownerId),
        exact: true,
      });
    },
    onError: (error) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      showError(error.message);
    },
  });

  const cancel = useCallback(() => abort.current?.abort(), []);

  return { ...mutation, progress, cancel };
}
