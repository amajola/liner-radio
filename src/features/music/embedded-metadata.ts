import { readAudioDuration, titleFromFileName } from "./audio-duration";

export type EditableTrackMetadata = {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: number | null;
  trackNumber: number | null;
  discNumber: number | null;
  duration: number;
  artworkPreview: string | null;
  artworkUrl: string | null;
  musicBrainzId: string | null;
  metadataSource: "embedded" | "musicbrainz" | "manual";
};

export function metadataFromFileName(name: string) {
  const stem = name.replace(/\.[^.]+$/, "").replaceAll("_", " ").replace(/^\s*\d{1,3}[.\s_-]+/, "").trim();
  const split = stem.split(/\s+-\s+/);
  if (split.length > 1) {
    return { artist: split.shift()!.trim(), title: split.join(" - ").trim() };
  }
  return { artist: "", title: titleFromFileName(name) };
}

/**
 * Reads only tags and duration in the browser. The file never leaves the
 * device during this step and the parser is lazy-loaded so normal playback
 * does not pay for the metadata reader.
 */
export async function readEmbeddedMetadata(file: File): Promise<EditableTrackMetadata> {
  const fallbackDuration = () => readAudioDuration(file).catch(() => 0);
  const filename = metadataFromFileName(file.name);
  try {
    const { parseBlob } = await import("music-metadata");
    const parsed = await parseBlob(file, { duration: true });
    const picture = parsed.common.picture?.[0];
    let artworkPreview: string | null = null;
    if (picture) {
      // Copy out of the parser's ArrayBufferLike view so Blob never receives a
      // SharedArrayBuffer-backed value (which browsers intentionally reject).
      const bytes = new Uint8Array(picture.data.byteLength);
      bytes.set(picture.data);
      artworkPreview = URL.createObjectURL(new Blob([bytes], { type: picture.format }));
    }
    return {
      title: parsed.common.title?.trim() || filename.title,
      artist: parsed.common.artist?.trim() || filename.artist,
      album: parsed.common.album?.trim() || "",
      albumArtist: parsed.common.albumartist?.trim() || parsed.common.artist?.trim() || "",
      genre: parsed.common.genre?.[0]?.trim() || "",
      year: parsed.common.year || null,
      trackNumber: parsed.common.track.no || null,
      discNumber: parsed.common.disk.no || null,
      duration: Math.round(parsed.format.duration || (await fallbackDuration())),
      artworkPreview,
      artworkUrl: null,
      musicBrainzId: parsed.common.musicbrainz_recordingid || null,
      metadataSource: "embedded",
    };
  } catch {
    return {
      title: filename.title,
      artist: filename.artist,
      album: "",
      albumArtist: "",
      genre: "",
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: Math.round(await fallbackDuration()),
      artworkPreview: null,
      artworkUrl: null,
      musicBrainzId: null,
      metadataSource: "manual",
    };
  }
}
