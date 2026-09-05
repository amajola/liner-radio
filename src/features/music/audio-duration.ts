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
    const timeout = window.setTimeout(() => finish(), 10_000);
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

export const ACCEPTED_AUDIO = "audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm";

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
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
