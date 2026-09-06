import { useQuery } from "@tanstack/react-query";
import { Disc3, Library, Music2, Plus } from "lucide-react";
import { useState, type DragEvent } from "react";
import type { Track } from "../../../../lib/radio/model";
import { EmptyState, LoadingState } from "../../../shared/components/AsyncState";
import { formatDuration } from "../audio-duration";
import { trackLibraryQueryOptions } from "../queries";

const QUICK_LIMIT = 4;

/**
 * The shallow view: enough to add a track without leaving the room, with the
 * full catalogue one button away so the column stays readable.
 */
export function LibraryQuickView({
  ownerId,
  canUpload,
  actionLabel,
  onPick,
  disabled,
  onBrowse,
  onUpload,
  onDropFile,
}: {
  ownerId: string;
  canUpload: boolean;
  actionLabel?: string;
  onPick?: (track: Track) => void;
  disabled?: boolean;
  onBrowse: () => void;
  onUpload: () => void;
  onDropFile: (file: File) => void;
}) {
  const library = useQuery(trackLibraryQueryOptions(ownerId));
  const [dragging, setDragging] = useState(false);
  const tracks = library.data?.tracks ?? [];

  function onDrop(event: DragEvent) {
    if (!canUpload) return;
    event.preventDefault();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files).find((item) =>
      item.type.startsWith("audio/"),
    );
    if (dropped) onDropFile(dropped);
  }

  return (
    <section
      className={`quick-panel ${dragging ? "is-dragging" : ""}`}
      onDragOver={
        canUpload
          ? (event) => {
              event.preventDefault();
              setDragging(true);
            }
          : undefined
      }
      onDragLeave={canUpload ? () => setDragging(false) : undefined}
      onDrop={canUpload ? onDrop : undefined}
    >
      <div className="quick-heading">
        <h2>
          <Library size={15} /> {canUpload ? "Your library" : "Host library"}
        </h2>
        <span>{tracks.length}</span>
      </div>

      {library.isPending && <LoadingState label="Loading music…" />}
      {library.data && !tracks.length && (
        <EmptyState>
          {canUpload ? "Upload a track to start the station." : "No music uploaded yet."}
        </EmptyState>
      )}

      <div className="scroll-region quick-list">
        {tracks.slice(0, QUICK_LIMIT).map((track) => (
          <article className="track-row compact" key={track.id}>
            <Music2 size={20} />
            <div>
              <strong>{track.title}</strong>
              <p>
                {track.artist} · {formatDuration(track.duration)}
              </p>
            </div>
            {onPick && (
              <button
                className="btn btn--ghost btn--sm btn--icon"
                type="button"
                aria-label={`${actionLabel} ${track.title}`}
                title={actionLabel}
                disabled={disabled}
                onClick={() => onPick(track)}
              >
                <Plus size={16} />
              </button>
            )}
          </article>
        ))}
      </div>

      {dragging && <p className="drop-hint">Drop to upload</p>}

      <div className="quick-actions">
        <button className="btn btn--ghost btn--sm" type="button" onClick={onBrowse}>
          Browse all{tracks.length > QUICK_LIMIT ? ` (${tracks.length})` : ""}
        </button>
        {canUpload && (
          <button className="btn btn--ghost btn--sm" type="button" onClick={onUpload}>
            <Disc3 size={15} /> Add music
          </button>
        )}
      </div>
    </section>
  );
}
