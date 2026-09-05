import { useQuery } from "@tanstack/react-query";
import { Music2, Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import type { Track } from "../../../../lib/radio/model";
import { EmptyState, ErrorState, LoadingState } from "../../../shared/components/AsyncState";
import { Modal } from "../../../shared/components/Modal";
import { formatDuration } from "../audio-duration";
import { trackLibraryQueryOptions } from "../queries";

export function LibraryModal({
  open,
  onClose,
  ownerId,
  canUpload,
  actionLabel,
  onPick,
  disabled,
  onUpload,
}: {
  open: boolean;
  onClose: () => void;
  ownerId: string;
  canUpload: boolean;
  actionLabel?: string;
  onPick?: (track: Track) => void;
  disabled?: boolean;
  onUpload: () => void;
}) {
  const library = useQuery({ ...trackLibraryQueryOptions(ownerId), enabled: open && Boolean(ownerId) });
  const [term, setTerm] = useState("");

  const tracks = useMemo(() => {
    const all = library.data?.tracks ?? [];
    const needle = term.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (track) =>
        track.title.toLowerCase().includes(needle) || track.artist.toLowerCase().includes(needle),
    );
  }, [library.data, term]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="tall"
      title={canUpload ? "Your library" : "Host library"}
      subtitle={`${library.data?.tracks.length ?? 0} track${library.data?.tracks.length === 1 ? "" : "s"}`}
      footer={
        canUpload ? (
          <button className="secondary-button" type="button" onClick={onUpload}>
            <Upload size={16} /> Upload music
          </button>
        ) : undefined
      }
    >
      <div className="library-search">
        <Search size={16} />
        <input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by title or artist"
          aria-label="Search the library"
        />
      </div>

      {library.isPending && <LoadingState label="Loading uploaded music…" />}
      {library.isError && !library.data && (
        <ErrorState message={library.error.message} retry={() => void library.refetch()} />
      )}
      {library.data && !library.data.tracks.length && (
        <EmptyState>
          {canUpload
            ? "Your library is empty. Upload the first track to start the station."
            : "The host has not uploaded any music yet."}
        </EmptyState>
      )}
      {Boolean(library.data?.tracks.length) && !tracks.length && (
        <EmptyState>Nothing matches “{term}”.</EmptyState>
      )}

      <div className="library-list">
        {tracks.map((track) => (
          <article className="track-row compact" key={track.id}>
            <Music2 size={22} />
            <div>
              <strong>{track.title}</strong>
              <p>
                {track.artist} · {formatDuration(track.duration)}
              </p>
            </div>
            {onPick && (
              <button
                className="add-button"
                type="button"
                aria-label={`${actionLabel} ${track.title}`}
                title={actionLabel}
                disabled={disabled}
                onClick={() => onPick(track)}
              >
                <Plus size={17} />
              </button>
            )}
          </article>
        ))}
      </div>
    </Modal>
  );
}
