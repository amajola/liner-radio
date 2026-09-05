import { Copy, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../../../shared/components/Modal";
import { useUiStore } from "../../../stores/ui-store";

export function RoomSettingsModal({
  open,
  onClose,
  roomId,
  roomName,
  listeners,
  busy,
  onRename,
  onDelete,
  deleting,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomName: string;
  listeners?: number;
  busy: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const showNotice = useUiStore((state) => state.showNotice);
  const [name, setName] = useState(roomName);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setName(roomName);
      setConfirming(false);
    }
  }, [open, roomName]);

  const trimmed = name.trim();
  const renamed = trimmed && trimmed !== roomName;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!renamed) return;
    onRename(trimmed);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/?room=${roomId}`);
      showNotice("Room invite copied.");
    } catch {
      showNotice(`Room code: ${roomId}`);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Room settings"
      subtitle={
        listeners === undefined
          ? `Invite code ${roomId}`
          : `${listeners} listening · invite code ${roomId}`
      }
    >
      <form className="room-settings-form" onSubmit={submit}>
        <label>
          Room name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={70}
            required
          />
        </label>
        <button className="secondary-button" disabled={busy || !renamed}>
          {busy ? <LoaderCircle className="spin" size={16} /> : null}
          {renamed ? "Save name" : "Saved"}
        </button>
      </form>

      <button className="ghost-button wide" type="button" onClick={() => void copyCode()}>
        <Copy size={15} /> Copy invite link
      </button>

      <div className="modal-divider" />

      {/* Deleting ends the room for everyone in it, so it takes a second,
          deliberate confirmation rather than a single stray click. */}
      <div className="danger-zone">
        <div>
          <strong>Delete this room</strong>
          <small>
            Everyone listening is disconnected and the queue is discarded. Your uploaded
            music is not affected.
          </small>
        </div>
        {confirming ? (
          <div className="danger-confirm" role="group" aria-label="Confirm deleting the room">
            <p>
              <TriangleAlert size={15} /> Delete “{roomName}” for everyone?
            </p>
            <div>
              <button
                className="ghost-button"
                type="button"
                onClick={() => setConfirming(false)}
                disabled={deleting}
              >
                Keep it
              </button>
              <button
                className="danger-button"
                type="button"
                onClick={onDelete}
                disabled={deleting}
              >
                {deleting ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />}
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
            </div>
          </div>
        ) : (
          <button
            className="danger-button"
            type="button"
            onClick={() => setConfirming(true)}
            disabled={deleting}
          >
            <Trash2 size={15} /> Delete room
          </button>
        )}
      </div>
    </Modal>
  );
}
