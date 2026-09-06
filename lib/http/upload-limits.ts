/**
 * Every size bound for uploaded audio lives here because they are not
 * independent. The media ticket separately re-validates `bytes` before R2 is
 * ever read, so a cap raised in the upload path but not in the ticket makes a
 * file upload cleanly and then fail playback with a misleading "link expired"
 * error. Importing one constant in both places keeps that from drifting again.
 */
export const MAXIMUM_TRACK_BYTES = 300 * 1024 * 1024;

/**
 * Below this a single `POST /api/tracks` still carries the whole file as form
 * data. Above it the browser must use the multipart endpoints: `formData()`
 * buffers the entire body inside the Worker, which has a 128 MB memory ceiling
 * and a request-body cap well under a 300 MB track.
 */
export const DIRECT_UPLOAD_BYTES = 30 * 1024 * 1024;

/**
 * R2 requires every part except the last to be the same size, and at least
 * 5 MiB. 8 MiB keeps a 300 MB track under 40 parts while leaving each request
 * small enough to buffer in the Worker without approaching the memory limit.
 */
export const UPLOAD_PART_BYTES = 8 * 1024 * 1024;

export const MAXIMUM_TRACK_COUNT = 200;

/**
 * A per-host storage ceiling, not a technical limit — tune it against what R2
 * storage is worth to you. At 300 MB a track this is roughly 34 full-size
 * tracks, or many more typical ones.
 */
export const MAXIMUM_LIBRARY_BYTES = 10 * 1024 * 1024 * 1024;

/** Uploads that never completed are swept after this long. */
export const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1_000;

/**
 * How often the Worker's scheduled handler reclaims them. Lives here rather
 * than in the Worker entry because `alchemy.run.ts` needs it at deploy time and
 * runs under Node, where importing the Worker would pull in `cloudflare:workers`.
 */
export const SWEEP_CRON = "0 * * * *";

export function partCountFor(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / UPLOAD_PART_BYTES));
}

/**
 * The exact length part `partNumber` (1-indexed) must have. Only the final part
 * is allowed to be short, so this is checked server-side per part rather than
 * trusted from the client.
 */
export function expectedPartBytes(totalBytes: number, partNumber: number): number {
  const parts = partCountFor(totalBytes);
  if (partNumber < 1 || partNumber > parts) return 0;
  if (partNumber < parts) return UPLOAD_PART_BYTES;
  return totalBytes - UPLOAD_PART_BYTES * (parts - 1);
}
