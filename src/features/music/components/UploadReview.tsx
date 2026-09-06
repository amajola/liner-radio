import { motion } from "motion/react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  Copy,
  Disc3,
  FileAudio,
  LoaderCircle,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  ACCEPTED_AUDIO,
  formatDuration,
  formatFileSize,
} from "../audio-duration";
import type { MetadataResult } from "../queries";
import type { IntakeTrack } from "./AddMusicModal";

export function uploadIssue(item: IntakeTrack) {
  if (item.reading) return "Reading file…";
  if (!item.title.trim()) return "Add a title";
  if (!item.artist.trim()) return "Add an artist";
  if (!Number.isFinite(item.duration) || item.duration < 1)
    return "Couldn’t read this audio";
  if (item.duration > 14_400) return "Over the four-hour limit";
  if (
    item.title.length > 180 ||
    item.artist.length > 180 ||
    item.album.length > 180 ||
    item.albumArtist.length > 180
  )
    return "Shorten details to 180 characters";
  if (item.genre.length > 80) return "Shorten genre to 80 characters";
  if (item.year !== null && (item.year < 1000 || item.year > 3000))
    return "Check the release year";
  if (
    item.trackNumber !== null &&
    (item.trackNumber < 1 || item.trackNumber > 999)
  )
    return "Check the track number";
  if (item.discNumber !== null && (item.discNumber < 1 || item.discNumber > 99))
    return "Check the disc number";
  return null;
}

function Cover({
  src,
  large = false,
}: {
  src: string | null;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className={`upload-cover ${large ? "upload-cover--large" : ""}`}>
      {src && src !== failed ? (
        <img src={src} alt="" onError={() => setFailed(src)} />
      ) : (
        <Disc3 size={large ? 36 : 22} strokeWidth={1.4} />
      )}
    </span>
  );
}

export function UploadTrackList({
  items,
  selected,
  onSelect,
  onRemove,
  onFiles,
}: {
  items: IntakeTrack[];
  selected: IntakeTrack;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const complete = items.filter((item) => !uploadIssue(item)).length;
  return (
    <aside className="upload-track-sidebar">
      <div className="upload-sidebar-heading">
        <div>
          <span className="upload-eyebrow">YOUR SELECTION</span>
          <h3>
            {items.length} track{items.length === 1 ? "" : "s"}
          </h3>
        </div>
        <button
          className="btn btn--quiet btn--sm btn--icon"
          type="button"
          onClick={() => input.current?.click()}
          aria-label="Add more audio files"
        >
          <Plus size={19} />
        </button>
      </div>
      <input
        ref={input}
        className="upload-file-input"
        tabIndex={-1}
        type="file"
        accept={ACCEPTED_AUDIO}
        multiple
        aria-label="Add more audio files"
        onChange={(event) => {
          onFiles(Array.from(event.target.files || []));
          event.target.value = "";
        }}
      />
      <div className="upload-track-list" aria-label="Tracks to upload">
        {items.map((item, index) => {
          const issue = uploadIssue(item);
          return (
            <div
              className={`upload-track ${item.id === selected.id ? "is-selected" : ""}`}
              key={item.id}
            >
              <button
                className="upload-track-select"
                type="button"
                aria-pressed={item.id === selected.id}
                onClick={() => onSelect(item.id)}
              >
                <span className="upload-track-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="upload-track-copy">
                  <strong>{item.title || item.file.name}</strong>
                  <small>
                    {item.reading
                      ? "Reading details…"
                      : item.artist || "Artist needed"}
                  </small>
                </span>
                <span
                  className={`upload-track-status ${issue && !item.reading ? "needs-attention" : ""}`}
                  title={issue || "Ready"}
                >
                  {item.reading ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : issue ? (
                    <AlertCircle size={15} />
                  ) : (
                    <Check size={15} />
                  )}
                </span>
              </button>
              <button
                className="upload-remove"
                type="button"
                aria-label={`Remove ${item.title}`}
                onClick={() => onRemove(item.id)}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="upload-sidebar-footer">
        <span>
          {complete} of {items.length} ready
        </span>
        <progress
          value={complete}
          max={items.length}
          aria-label="Tracks ready to upload"
        />
      </div>
    </aside>
  );
}

export function UploadTrackEditor({
  item,
  count,
  update,
  applyAlbum,
  search,
  onSearch,
  onMatch,
}: {
  item: IntakeTrack;
  count: number;
  update: (patch: Partial<IntakeTrack>) => void;
  applyAlbum: () => void;
  search: {
    status: "idle" | "loading" | "error" | "matched" | "results";
    results: MetadataResult[];
  };
  onSearch: () => void;
  onMatch: (match: MetadataResult) => void;
}) {
  const [copied, setCopied] = useState(false);
  const issue = uploadIssue(item);
  const primaryMatch = search.results[0];
  const [moreMatches, setMoreMatches] = useState(false);
  return (
    <motion.section
      className="upload-editor"
      key={item.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
    >
      <div className="upload-editor-heading">
        <span className="upload-eyebrow">MAKE IT YOURS</span>
        <span className={`upload-source ${item.reading ? "" : "is-ready"}`}>
          {item.reading ? (
            <LoaderCircle size={13} className="spin" />
          ) : (
            <Check size={13} />
          )}
          {item.reading
            ? "Reading file"
            : item.metadataSource === "musicbrainz"
              ? "Match applied"
              : item.metadataSource === "embedded"
                ? "File details loaded"
                : "Your details"}
        </span>
      </div>
      <div className="upload-track-identity">
        <Cover src={item.artworkUrl || item.artworkPreview} large />
        <div>
          <h3>{item.title || "Untitled track"}</h3>
          <p>{item.artist || "Add the artist below"}</p>
          <span>
            <FileAudio size={13} />
            {formatFileSize(item.file.size)}
            {item.duration > 0 && <> · {formatDuration(item.duration)}</>}
          </span>
        </div>
      </div>
      <fieldset className="upload-fields-main" disabled={item.reading}>
        <legend className="upload-sr-only">Track details</legend>
        <label>
          Track title
          <input
            value={item.title}
            maxLength={180}
            placeholder="Give this track a name"
            onChange={(event) => update({ title: event.target.value })}
          />
        </label>
        <label>
          Artist
          <input
            value={item.artist}
            maxLength={180}
            placeholder="Who’s behind the music?"
            onChange={(event) => update({ artist: event.target.value })}
          />
        </label>
      </fieldset>
      {issue && !item.reading && (
        <p className="upload-field-hint">
          <AlertCircle size={14} />
          {issue}
        </p>
      )}
      <div className="upload-match-panel">
        <div className="upload-match-heading">
          <span>
            <Sparkles size={16} />
            Find the details
          </span>
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={onSearch}
            disabled={
              item.reading || !item.title.trim() || search.status === "loading"
            }
          >
            {search.status === "loading" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Search size={14} />
            )}
            Search
          </button>
        </div>
        {search.status === "loading" && (
          <p className="upload-match-note" role="status">
            Looking for a match on MusicBrainz…
          </p>
        )}
        {search.status === "idle" && (
          <p className="upload-match-note">
            Add a title and artist for automatic suggestions.
          </p>
        )}
        {search.status === "error" && (
          <p className="upload-match-note">
            Lookup is unavailable. Your own details work just fine.
          </p>
        )}
        {search.status === "matched" && (
          <p className="upload-match-note upload-match-applied">
            <Check size={15} />
            Details applied. You can still change anything.
          </p>
        )}
        {search.status === "results" && !primaryMatch && (
          <p className="upload-match-note">
            No match this time. Use your own details below.
          </p>
        )}
        {search.status === "results" && primaryMatch && (
          <>
            {(moreMatches ? search.results.slice(0, 3) : [primaryMatch]).map(
              (match) => (
                <button
                  className="upload-match-option"
                  type="button"
                  key={match.id}
                  onClick={() => onMatch(match)}
                >
                  <Cover src={match.artworkUrl} />
                  <span>
                    <strong>{match.title}</strong>
                    <small>
                      {[match.artist, match.album, match.year]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  <span className="upload-match-use">
                    Use <Plus size={14} />
                  </span>
                </button>
              ),
            )}
            {search.results.length > 1 && (
              <button
                type="button"
                className="upload-text-button"
                onClick={() => setMoreMatches(!moreMatches)}
              >
                {moreMatches ? "Show less" : "See other matches"}
                <ChevronDown
                  size={13}
                  className={moreMatches ? "is-open" : ""}
                />
              </button>
            )}
          </>
        )}
      </div>
      <fieldset className="upload-album-fields" disabled={item.reading}>
        <legend>
          Album <span>Optional</span>
        </legend>
        <label className="upload-sr-only" htmlFor={`album-${item.id}`}>
          Album title
        </label>
        <input
          id={`album-${item.id}`}
          value={item.album}
          maxLength={180}
          placeholder="A home for this track"
          onChange={(event) => {
            setCopied(false);
            update({ album: event.target.value });
          }}
        />
        {count > 1 && item.album.trim() && (
          <button
            type="button"
            className="upload-text-button"
            onClick={() => {
              applyAlbum();
              setCopied(true);
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied
              ? "Album details applied to all tracks"
              : `Use these album details for all ${count} tracks`}
          </button>
        )}
      </fieldset>
      <details className="upload-extra">
        <summary>
          More details
          <span>
            Genre, year & track numbers <ChevronDown size={15} />
          </span>
        </summary>
        <fieldset className="upload-fields-extra" disabled={item.reading}>
          <legend className="upload-sr-only">Optional details</legend>
          <label>
            Album artist
            <input
              value={item.albumArtist}
              maxLength={180}
              placeholder={item.artist || "Album artist"}
              onChange={(event) => update({ albumArtist: event.target.value })}
            />
          </label>
          <label>
            Genre
            <input
              value={item.genre}
              maxLength={80}
              placeholder="e.g. Jazz"
              onChange={(event) => update({ genre: event.target.value })}
            />
          </label>
          <label>
            Year
            <input
              type="number"
              min="1000"
              max="3000"
              value={item.year ?? ""}
              placeholder="—"
              onChange={(event) =>
                update({
                  year: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </label>
          <label>
            Track number
            <input
              type="number"
              min="1"
              max="999"
              value={item.trackNumber ?? ""}
              placeholder="—"
              onChange={(event) =>
                update({
                  trackNumber: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </label>
          <label>
            Disc number
            <input
              type="number"
              min="1"
              max="99"
              value={item.discNumber ?? ""}
              placeholder="—"
              onChange={(event) =>
                update({
                  discNumber: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </label>
        </fieldset>
      </details>
    </motion.section>
  );
}
