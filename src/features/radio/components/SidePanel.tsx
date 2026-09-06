import { Check, Inbox, X } from "lucide-react";
import { useState } from "react";
import type { Room, Track } from "../../../../lib/radio/model";
import { EmptyState } from "../../../shared/components/AsyncState";
import { LibraryModal } from "../../music/components/LibraryModal";
import { LibraryQuickView } from "../../music/components/LibraryQuickView";
import { UploadTrackModal } from "../../music/components/UploadTrackModal";
import { PeopleModal, PeopleQuickView } from "./PeoplePanel";

type Props = {
  room: Room;
  userId: string;
  busy: boolean;
  isHost: boolean;
  act: (type: string, extra?: Record<string, unknown>) => void;
};

export function SidePanel(props: Props) {
  const { room, isHost } = props;
  const member = room.members.find((item) => item.id === props.userId);
  const host = room.members.find((item) => item.role === "host");
  const [browsing, setBrowsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showingPeople, setShowingPeople] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);

  // The host already controls the programme, so their library adds straight to
  // the queue; only listeners ever "request" anything.
  const canRequest = Boolean(room.requestsOpen && member?.canRequest);
  const actionLabel = isHost ? "Add to queue" : "Request";
  const visibleRequests = isHost
    ? room.requests
    : room.requests.filter((track) => track.requestedBy === props.userId);

  function pickTrack(track: Track) {
    props.act(isHost ? "enqueue" : "request", { track });
  }

  function openUploadWith(file: File) {
    setDroppedFile(file);
    setUploading(true);
  }

  return (
    <section className="room-column side-column">
      <div className="column-heading">
        <Inbox size={17} />
        <strong>{isHost ? "LIBRARY" : "REQUESTS"}</strong>
        <span>{isHost ? room.requests.length : visibleRequests.length}</span>
      </div>

      <div className="scroll-region column-scroll list-scroll">
        {isHost || canRequest ? (
          <LibraryQuickView
            ownerId={host?.id ?? ""}
            canUpload={isHost}
            actionLabel={actionLabel}
            onPick={pickTrack}
            disabled={props.busy}
            onBrowse={() => setBrowsing(true)}
            onUpload={() => {
              setDroppedFile(null);
              setUploading(true);
            }}
            onDropFile={openUploadWith}
          />
        ) : (
          <section className="quick-panel">
            <EmptyState>Song requests are closed for you right now.</EmptyState>
          </section>
        )}

        <section className="quick-panel">
          <div className="quick-heading">
            <h2>{isHost ? "Request inbox" : "Your requests"}</h2>
            <span>{visibleRequests.length}</span>
          </div>
          {visibleRequests.map((track) => (
            <article className="track-row compact" key={track.key}>
              <div>
                <strong>{track.title}</strong>
                <p>
                  {track.artist} · {track.requestedName}
                </p>
              </div>
              {isHost && (
                <div className="row-actions">
                  <button
                    className="btn btn--quiet btn--xs btn--icon"
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.act("approve", { key: track.key })}
                    aria-label={`Approve ${track.title}`}
                  >
                    <Check size={18} />
                  </button>
                  <button
                    className="btn btn--quiet btn--xs btn--icon"
                    type="button"
                    disabled={props.busy}
                    onClick={() => props.act("reject", { key: track.key })}
                    aria-label={`Reject ${track.title}`}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
            </article>
          ))}
          {!visibleRequests.length && (
            <EmptyState>
              {isHost ? "No requests waiting." : "You have not requested anything yet."}
            </EmptyState>
          )}
        </section>

        <PeopleQuickView room={room} onOpen={() => setShowingPeople(true)} />
      </div>

      <LibraryModal
        open={browsing}
        onClose={() => setBrowsing(false)}
        ownerId={host?.id ?? ""}
        canUpload={isHost}
        actionLabel={actionLabel}
        onPick={pickTrack}
        disabled={props.busy}
        onUpload={() => {
          setBrowsing(false);
          setDroppedFile(null);
          setUploading(true);
        }}
      />
      <UploadTrackModal
        open={uploading}
        onClose={() => setUploading(false)}
        ownerId={props.userId}
        initialFile={droppedFile}
      />
      <PeopleModal
        open={showingPeople}
        onClose={() => setShowingPeople(false)}
        room={room}
        isHost={isHost}
        busy={props.busy}
        act={props.act}
      />
    </section>
  );
}
