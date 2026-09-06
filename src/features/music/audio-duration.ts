import { AUDIO_EXTENSIONS } from "../../../lib/http/audio-types";

/** Reads duration from the file itself so the server never has to trust a guess. */
export function readAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const finish = (duration?: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(source);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      audio.removeAttribute("src");
      if (duration && Number.isFinite(duration)) resolve(duration);
      else reject(new Error("The browser could not read this audio file."));
    };
    // A 300 MB file only has its metadata read here, but decoding the header
    // off a blob that large is slow enough on a mid-range phone to beat a flat
    // ten-second budget, so the allowance grows with the file.
    const budget = Math.min(45_000, 10_000 + (file.size / (1024 * 1024)) * 100);
    const timeout = window.setTimeout(() => finish(), budget);
    audio.onloadedmetadata = () => {
      window.clearTimeout(timeout);
      finish(audio.duration);
    };
    audio.onerror = () => {
      window.clearTimeout(timeout);
      finish();
    };
    audio.preload = "metadata";
    audio.src = source;
  });
}

/**
 * Offered to the file picker as a hint only. The operating system reports types
 * inconsistently, so what is actually admissible is decided by
 * `resolveAudioType`, and the extensions are listed here for the files whose
 * type a browser reports as "".
 */
export const ACCEPTED_AUDIO = [
  "audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/flac,audio/webm",
  ...AUDIO_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");

export function titleFromFileName(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
