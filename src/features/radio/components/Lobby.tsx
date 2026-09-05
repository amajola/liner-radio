import { useQuery } from "@tanstack/react-query";
import { Headphones, KeyRound, Plus, Radio, Settings } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LibraryModal } from "../../music/components/LibraryModal";
import { LibraryQuickView } from "../../music/components/LibraryQuickView";
import { UploadTrackModal } from "../../music/components/UploadTrackModal";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  QueryFreshness,
} from "../../../shared/components/AsyncState";
import { roomsQueryOptions, type RoomSummary } from "../queries";
import { useRoomMutations } from "../use-room-mutations";
import { Modal } from "../../../shared/components/Modal";
import { useMediaQuery } from "../../../shared/use-media-query";
import { RoomSettingsModal } from "./RoomSettingsModal";

type EntryIntent = "create" | "join" | null;

export function Lobby({ userId }: { userId: string }) {
  // Two full entry cards do not fit beside the panels on a phone, and this page
  // never scrolls, so on small screens they move behind a pair of buttons.
  const compact = useMediaQuery("(max-width: 780px)");
  const [entry, setEntry] = useState<EntryIntent>(null);
  const rooms = useQuery(roomsQueryOptions());
  const { createRoom, joinRoom, closeRoom, renameRoom } = useRoomMutations();
  const [roomName, setRoomName] = useState("After hours");
  const [browsing, setBrowsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [managing, setManaging] = useState<RoomSummary | null>(null);
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase() || "",
  );
  const busy = createRoom.isPending || joinRoom.isPending;
  const ownedRooms = rooms.data?.rooms ?? [];

  function create(event: FormEvent) {
    event.preventDefault();
    createRoom.mutate({ name: roomName });
  }

  function join(event: FormEvent) {
    event.preventDefault();
    joinRoom.mutate({ roomId: code });
  }

  const createFields = (
    <label>
      Room name
      <input
        value={roomName}
        onChange={(event) => setRoomName(event.target.value)}
        maxLength={70}
        required
      />
    </label>
  );

  const joinFields = (
    <label>
      Invite code
      <input
        value={code}
        onChange={(event) => setCode(event.target.value.toUpperCase())}
        placeholder="Enter the room code"
        maxLength={12}
        required
      />
    </label>
  );

  return (
    <div className="lobby">
      <div className="lobby-heading">
        <p className="eyebrow">A ROOM. A HOST. YOUR NEXT FAVOURITE SONG.</p>
        <h1>
          Pass the music around<span>.</span>
        </h1>
      </div>

      {compact ? (
        <div className="entry-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => setEntry("create")}
            disabled={busy}
          >
            <Radio size={17} /> Host a room
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setEntry("join")}
            disabled={busy}
          >
            <KeyRound size={16} /> Join with code
          </button>
        </div>
      ) : (
        <div className="entry-grid">
          <form className="entry-card entry-card-dark" onSubmit={create}>
            <Radio size={26} />
            <div>
              <p className="eyebrow">HOST</p>
              <h2>Take the booth</h2>
            </div>
            {createFields}
            <button className="primary-button primary-light" disabled={busy}>
              Create a room <Plus size={17} />
            </button>
          </form>

          <form className="entry-card" onSubmit={join}>
            <Headphones size={26} />
            <div>
              <p className="eyebrow">LISTEN</p>
              <h2>Find your people</h2>
            </div>
            {joinFields}
            <button className="secondary-button" disabled={busy}>
              Join room
            </button>
          </form>
        </div>
      )}

      {/* Two fixed panels. Only their lists scroll, so the lobby itself never
          moves and everything stays visible at a glance. */}
      <div className="lobby-panels">
        <section className="quick-panel lobby-panel">
          <div className="quick-panel">
            <div className="quick-heading">
              <h2>Your rooms</h2>
              <span>
                {ownedRooms.length}
                {rooms.data && (
                  <QueryFreshness
                    isFetching={rooms.isFetching}
                    isStale={rooms.isStale}
                    hasError={rooms.isError}
                  />
                )}
              </span>
            </div>
            <div className="lobby-panel-scroll">
              {rooms.isPending && <LoadingState label="Loading your rooms…" />}
              {rooms.isError && !rooms.data && (
                <ErrorState
                  message={rooms.error.message}
                  retry={() => void rooms.refetch()}
                />
              )}
              {rooms.data && ownedRooms.length === 0 && (
                <EmptyState>Take the booth to make your first room.</EmptyState>
              )}
              <div className="owned-list">
                {ownedRooms.map((ownedRoom) => (
                  <div className="owned-row" key={ownedRoom.id}>
                    <button
                      type="button"
                      className="owned-open"
                      disabled={busy}
                      onClick={() => joinRoom.mutate({ roomId: ownedRoom.id })}
                    >
                      <span>{ownedRoom.name}</span>
                      <strong>{ownedRoom.id}</strong>
                    </button>
                    <button
                      type="button"
                      className="owned-manage"
                      onClick={() => setManaging(ownedRoom)}
                      aria-label={`Manage ${ownedRoom.name}`}
                      title="Room settings"
                    >
                      <Settings size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="quick-panel lobby-panel">
          <LibraryQuickView
            ownerId={userId}
            canUpload
            onBrowse={() => setBrowsing(true)}
            onUpload={() => {
              setDroppedFile(null);
              setUploading(true);
            }}
            onDropFile={(file) => {
              setDroppedFile(file);
              setUploading(true);
            }}
          />
        </section>
      </div>

      <Modal
        open={entry !== null}
        onClose={() => setEntry(null)}
        title={entry === "join" ? "Join a room" : "Host a room"}
        subtitle={
          entry === "join"
            ? "Enter the invite code the host shared with you."
            : "Name your room, then share the invite code."
        }
      >
        <form
          className="entry-modal-form"
          onSubmit={(event) => {
            if (entry === "join") join(event);
            else create(event);
          }}
        >
          {entry === "join" ? joinFields : createFields}
          <button className="primary-button" disabled={busy}>
            {entry === "join" ? (
              <>
                Join room <Headphones size={16} />
              </>
            ) : (
              <>
                Create a room <Plus size={16} />
              </>
            )}
          </button>
        </form>
      </Modal>

      <RoomSettingsModal
        open={Boolean(managing)}
        onClose={() => setManaging(null)}
        roomId={managing?.id ?? ""}
        roomName={managing?.name ?? ""}
        busy={renameRoom.isPending}
        deleting={closeRoom.isPending}
        onRename={(name) => {
          if (!managing) return;
          renameRoom.mutate(
            { roomId: managing.id, name },
            { onSuccess: () => setManaging(null) },
          );
        }}
        onDelete={() => {
          if (!managing) return;
          closeRoom.mutate(
            { roomId: managing.id, reason: "closed" },
            { onSuccess: () => setManaging(null) },
          );
        }}
      />

      <LibraryModal
        open={browsing}
        onClose={() => setBrowsing(false)}
        ownerId={userId}
        canUpload
        onUpload={() => {
          setBrowsing(false);
          setDroppedFile(null);
          setUploading(true);
        }}
      />
      <UploadTrackModal
        open={uploading}
        onClose={() => setUploading(false)}
        ownerId={userId}
        initialFile={droppedFile}
      />
    </div>
  );
}
