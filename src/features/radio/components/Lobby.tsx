import { useQuery } from "@tanstack/react-query";
import { Headphones, KeyRound, Library, ListMusic, Plus, Radio } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LibraryModal } from "../../music/components/LibraryModal";
import { LibraryQuickView } from "../../music/components/LibraryQuickView";
import { AddMusicModal as UploadTrackModal } from "../../music/components/AddMusicModal";
import { QueryFreshness } from "../../../shared/components/AsyncState";
import { roomsQueryOptions, type RoomSummary } from "../queries";
import { useRoomMutations } from "../use-room-mutations";
import { Modal } from "../../../shared/components/Modal";
import { useMediaQuery } from "../../../shared/use-media-query";
import { OwnedRoomsList, RoomsModal } from "./OwnedRooms";
import { RoomSettingsModal } from "./RoomSettingsModal";
import { trackLibraryQueryOptions } from "../../music/queries";

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
  const [showingRooms, setShowingRooms] = useState(false);
  const [code, setCode] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase() || "",
  );
  const library = useQuery({ ...trackLibraryQueryOptions(userId), enabled: Boolean(userId) });
  const busy = createRoom.isPending || joinRoom.isPending;
  const ownedRooms = rooms.data?.rooms ?? [];
  const trackCount = library.data?.tracks.length ?? 0;

  const roomListProps = {
    rooms,
    busy,
    onOpen: (room: RoomSummary) => joinRoom.mutate({ roomId: room.id }),
    onManage: (room: RoomSummary) => setManaging(room),
  };

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
            className="btn btn--primary btn--lg"
            type="button"
            onClick={() => setEntry("create")}
            disabled={busy}
          >
            <Radio size={17} /> Host a room
          </button>
          <button
            className="btn btn--secondary btn--lg"
            type="button"
            onClick={() => setEntry("join")}
            disabled={busy}
          >
            <KeyRound size={16} /> Join with code
          </button>
        </div>
      ) : (
        <div className="entry-grid">
          <form className="surface surface--lg surface--inverse entry-card" onSubmit={create}>
            <Radio size={26} />
            <div>
              <p className="eyebrow">HOST</p>
              <h2>Take the booth</h2>
            </div>
            {createFields}
            <button className="btn btn--accent btn--lg" disabled={busy}>
              Create a room <Plus size={17} />
            </button>
          </form>

          <form className="surface surface--lg entry-card" onSubmit={join}>
            <Headphones size={26} />
            <div>
              <p className="eyebrow">LISTEN</p>
              <h2>Find your people</h2>
            </div>
            {joinFields}
            <button className="btn btn--secondary btn--lg" disabled={busy}>
              Join room
            </button>
          </form>
        </div>
      )}

      {/* On a phone there is no room for two panels on a page that never
          scrolls, so the lists live in modals behind buttons that carry their
          counts. Wider screens keep both panels in view. */}
      {compact ? (
        <div className="lobby-actions">
          <button className="surface lobby-action" type="button" onClick={() => setShowingRooms(true)}>
            <ListMusic size={18} />
            <span>Your rooms</span>
            <strong>{ownedRooms.length}</strong>
          </button>
          <button className="surface lobby-action" type="button" onClick={() => setBrowsing(true)}>
            <Library size={18} />
            <span>Music library</span>
            <strong>{trackCount}</strong>
          </button>
        </div>
      ) : (
      <div className="lobby-panels">
        <section className="surface quick-panel lobby-panel">
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
            <div className="scroll-region">
              <OwnedRoomsList {...roomListProps} />
            </div>
          </div>
        </section>

        <section className="surface quick-panel lobby-panel">
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
      )}

      <RoomsModal
        open={showingRooms}
        onClose={() => setShowingRooms(false)}
        {...roomListProps}
      />

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
          <button className="btn btn--primary btn--lg" disabled={busy}>
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
