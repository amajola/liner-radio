/**
 * Browsers disagree about audio MIME types, and the operating system is free to
 * report nothing at all. macOS Chrome calls an `.m4a` `audio/x-m4a`, some
 * builds call it `video/mp4`, and a file with an unregistered extension arrives
 * as `""`. Trusting `File.type` verbatim therefore rejects files the picker
 * itself accepted, so both sides resolve through this instead.
 */

/** Containers the player can decode. Shared with the file picker's filter. */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "mp4",
  "wav",
  "flac",
  "ogg",
  "oga",
  "opus",
  "webm",
] as const;

export const AUDIO_EXTENSION_PATTERN = /\.(mp3|m4a|mp4|wav|flac|ogg|oga|opus|webm)$/i;

/** One stored type per container, so playback never sees a vendor spelling. */
const byExtension: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  wav: "audio/wav",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
};

const byMimeType: Record<string, string> = {
  "audio/mpeg": "audio/mpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-mpeg": "audio/mpeg",
  "audio/mp4": "audio/mp4",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "video/mp4": "audio/mp4",
  "audio/wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-wav": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "audio/flac": "audio/flac",
  "audio/x-flac": "audio/flac",
  "audio/ogg": "audio/ogg",
  "audio/opus": "audio/ogg",
  "audio/vorbis": "audio/ogg",
  "application/ogg": "audio/ogg",
  "audio/webm": "audio/webm",
  "video/webm": "audio/webm",
};

export const AUDIO_FORMAT_LABEL = "MP3, M4A, WAV, FLAC, OGG or WebM";

/**
 * The canonical type to store, or null when neither signal identifies a
 * supported container. The extension wins because it names the container
 * directly, while `File.type` is only the operating system's guess about it.
 */
export function resolveAudioType(mimeType: string, fileName = ""): string | null {
  const extension = AUDIO_EXTENSION_PATTERN.exec(fileName)?.[1]?.toLowerCase();
  if (extension && byExtension[extension]) return byExtension[extension];
  return byMimeType[mimeType.trim().toLowerCase()] ?? null;
}

/** Whether the picker should offer this file at all. */
export function looksLikeAudio(file: { type: string; name: string }): boolean {
  return resolveAudioType(file.type, file.name) !== null;
}
