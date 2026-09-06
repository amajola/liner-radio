import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Headphones } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { looksLikeAudio } from "../../../../lib/http/audio-types";
import { MAXIMUM_TRACK_BYTES } from "../../../../lib/http/upload-limits";
import { UploadDropzone } from "./UploadDropzone";
import {
  UploadTrackEditor,
  UploadTrackList,
  uploadIssue,
} from "./UploadReview";
import { Modal } from "../../../shared/components/Modal";
import { useUiStore } from "../../../stores/ui-store";
import { formatFileSize } from "../audio-duration";
import { runBackgroundUploads } from "../background-upload";
import {
  metadataFromFileName,
  readEmbeddedMetadata,
  type EditableTrackMetadata,
} from "../embedded-metadata";
import { metadataSearchQueryOptions, type MetadataResult } from "../queries";

export type IntakeTrack = EditableTrackMetadata & {
  id: string;
  file: File;
  reading: boolean;
};

function blankMetadata(file: File): IntakeTrack {
  const filename = metadataFromFileName(file.name);
  return {
    id: crypto.randomUUID(),
    file,
    reading: true,
    title: filename.title,
    artist: filename.artist,
    album: "",
    albumArtist: "",
    genre: "",
    year: null,
    trackNumber: null,
    discNumber: null,
    duration: 0,
    artworkPreview: null,
    artworkUrl: null,
    musicBrainzId: null,
    metadataSource: "manual",
  };
}

export function AddMusicModal({
  open,
  onClose,
  ownerId,
  initialFile,
}: {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  initialFile?: File | null;
}) {
  const intakeGeneration = useRef(0);
  const artworkUrls = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const showError = useUiStore((state) => state.showError);
  const [items, setItems] = useState<IntakeTrack[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [albumApplied, setAlbumApplied] = useState(false);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [lookup, setLookup] = useState({ title: "", artist: "", trackId: "" });
  const selected =
    items.find((item) => item.id === selectedId) || items[0] || null;
  const lookupCurrent = Boolean(
    selected &&
      lookup.trackId === selected.id &&
      lookup.title === selected.title &&
      lookup.artist === selected.artist,
  );

  const search = useQuery({
    ...metadataSearchQueryOptions(lookup.title, lookup.artist),
    enabled: open && Boolean(lookup.title && lookup.trackId),
  });

  useEffect(() => {
    if (
      !open ||
      !selected ||
      selected.reading ||
      selected.metadataSource === "musicbrainz"
    )
      return;
    const timeout = window.setTimeout(() => {
      setLookup({
        title: selected.title,
        artist: selected.artist,
        trackId: selected.id,
      });
    }, 650);
    return () => window.clearTimeout(timeout);
  }, [
    open,
    selected?.id,
    selected?.title,
    selected?.artist,
    selected?.reading,
    selected?.metadataSource,
  ]);

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.file.size, 0),
    [items],
  );
  const ready = Boolean(
    items.length &&
      rightsConfirmed &&
      items.every((item) => !uploadIssue(item)),
  );

  async function takeFiles(files: File[]) {
    const candidates = files.filter(looksLikeAudio);
    const tooLarge = candidates.find((file) => file.size > MAXIMUM_TRACK_BYTES);
    if (tooLarge) {
      showError(
        `${tooLarge.name} is over ${Math.round(MAXIMUM_TRACK_BYTES / 1024 / 1024)} MB.`,
      );
      return;
    }
    if (!candidates.length) {
      showError("Choose MP3, M4A, WAV, FLAC, OGG or WebM audio files.");
      return;
    }
    const generation = intakeGeneration.current;
    const pending = candidates.map(blankMetadata);
    setItems((current) => [...current, ...pending]);
    setSelectedId((current) => current || pending[0].id);
    await Promise.all(
      pending.map(async (item) => {
        const metadata = await readEmbeddedMetadata(item.file);
        if (generation !== intakeGeneration.current) {
          if (metadata.artworkPreview)
            URL.revokeObjectURL(metadata.artworkPreview);
          return;
        }
        if (metadata.artworkPreview)
          artworkUrls.current.add(metadata.artworkPreview);
        setItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id
              ? { ...candidate, ...metadata, reading: false }
              : candidate,
          ),
        );
      }),
    );
  }

  useEffect(() => {
    if (open && initialFile && !items.length) void takeFiles([initialFile]);
    if (!open) {
      intakeGeneration.current += 1;
      artworkUrls.current.forEach((url) => URL.revokeObjectURL(url));
      artworkUrls.current.clear();
      setItems([]);
      setSelectedId(null);
      setRightsConfirmed(false);
      setLookup({ title: "", artist: "", trackId: "" });
      setAlbumApplied(false);
    }
    // Intake is deliberately reset whenever the sheet closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  function updateSelected(patch: Partial<IntakeTrack>) {
    if (!selected) return;
    setAlbumApplied(false);
    setItems((current) =>
      current.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              ...patch,
              metadataSource: patch.metadataSource || "manual",
            }
          : item,
      ),
    );
  }

  function applyMatch(match: MetadataResult) {
    setLookup({
      title: match.title,
      artist: match.artist,
      trackId: selected?.id || "",
    });
    updateSelected({
      title: match.title,
      artist: match.artist,
      album: match.album || selected?.album || "",
      albumArtist: match.albumArtist || match.artist,
      genre: match.genre || selected?.genre || "",
      year: match.year,
      artworkUrl: match.artworkUrl,
      musicBrainzId: match.id,
      metadataSource: "musicbrainz",
    });
  }

  function remove(id: string) {
    const removed = items.find((item) => item.id === id);
    if (removed?.artworkPreview) URL.revokeObjectURL(removed.artworkPreview);
    const remaining = items.filter((item) => item.id !== id);
    setItems(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id || null);
  }

  function applyAlbumToAll() {
    if (!selected) return;
    setAlbumApplied(true);
    setItems((current) =>
      current.map((item) => ({
        ...item,
        album: selected.album,
        albumArtist: selected.albumArtist || selected.artist,
        genre: selected.genre || item.genre,
        year: selected.year || item.year,
        artworkUrl: selected.artworkUrl || item.artworkUrl,
      })),
    );
  }

  function beginUpload() {
    if (!ready) return;
    const queued = items.map((item) => ({ ...item }));
    void runBackgroundUploads(queued, ownerId, queryClient);
    onClose();
  }

  const reading = items.filter((item) => item.reading).length;
  const needsDetails = items.filter(
    (item) => !item.reading && uploadIssue(item),
  ).length;
  const statusMessage = reading
    ? `Reading ${reading} file${reading === 1 ? "" : "s"}…`
    : needsDetails
      ? `${needsDetails} track${needsDetails === 1 ? " needs" : "s need"} a quick check`
      : `${items.length} track${items.length === 1 ? "" : "s"} ready · ${formatFileSize(totalBytes)}`;
  const searchStatus =
    selected?.metadataSource === "musicbrainz"
      ? "matched"
      : !selected?.title.trim() || (!selected?.artist.trim() && !lookupCurrent)
        ? "idle"
        : !lookupCurrent || search.isFetching
          ? "loading"
          : search.isError
            ? "error"
            : search.data
              ? "results"
              : "idle";

  return (
    <Modal
      open={open}
      onClose={onClose}
      // Closing throws away every staged file and the tags edited against them,
      // none of which has reached the server yet. `beginUpload` calls onClose
      // directly, so confirming a submit is never asked for.
      confirmClose={() =>
        items.length
          ? `Discard ${items.length} track${items.length === 1 ? "" : "s"} and the details you have added?`
          : null
      }
      size="upload"
      title="Add to your library"
      subtitle="Your music. Ready for the room."
      footer={
        items.length > 0 ? (
          <div className="upload-footer">
            <div className="upload-footer-confirm">
              <label className="upload-rights">
                <input
                  type="checkbox"
                  checked={rightsConfirmed}
                  onChange={(event) => setRightsConfirmed(event.target.checked)}
                />
                <span>I have permission to stream this music.</span>
              </label>
              <span
                className={`upload-footer-status ${needsDetails ? "needs-attention" : ""}`}
                role="status"
              >
                {statusMessage}
              </span>
            </div>
            <div className="upload-footer-action">
              <button
                className="btn btn--accent btn--lg"
                type="button"
                disabled={!ready}
                onClick={beginUpload}
              >
                Upload {items.length === 1 ? "track" : `${items.length} tracks`}{" "}
                <ArrowRight size={17} />
              </button>
              <span>
                <Headphones size={12} /> Keep listening while we upload
              </span>
            </div>
          </div>
        ) : (
          <div className="upload-welcome-footer">
            <span>
              <Headphones size={16} /> Built for the long play.
            </span>
            <span>Albums, mixes and everything in between.</span>
          </div>
        )
      }
    >
      <ol className="upload-steps" aria-label="Upload steps">
        <li
          className={items.length ? "is-complete" : "is-current"}
          aria-current={!items.length ? "step" : undefined}
        >
          <span>{items.length ? <Check size={13} /> : "01"}</span>Choose files
        </li>
        <li
          className={items.length ? "is-current" : ""}
          aria-current={items.length ? "step" : undefined}
        >
          <span>02</span>Review details
        </li>
        <li>
          <span>03</span>Upload & listen
        </li>
      </ol>
      {!items.length ? (
        <UploadDropzone onFiles={(files) => void takeFiles(files)} />
      ) : (
        selected && (
          <div className="upload-review">
            <UploadTrackList
              items={items}
              selected={selected}
              onSelect={setSelectedId}
              onRemove={remove}
              onFiles={(files) => void takeFiles(files)}
            />
            <UploadTrackEditor
              key={selected.id}
              item={selected}
              count={items.length}
              update={updateSelected}
              applyAlbum={applyAlbumToAll}
              search={{
                status: searchStatus,
                results: lookupCurrent ? search.data?.results || [] : [],
              }}
              onSearch={() => {
                // Explicit search also works with a title alone.
                if (lookupCurrent) void search.refetch();
                else
                  setLookup({
                    title: selected.title,
                    artist: selected.artist,
                    trackId: selected.id,
                  });
              }}
              onMatch={applyMatch}
            />
          </div>
        )
      )}
      {albumApplied && (
        <span className="upload-sr-only" role="status">
          Album details applied to all tracks.
        </span>
      )}
    </Modal>
  );
}
