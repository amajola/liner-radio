import { DoorOpen } from "lucide-react";
import { Modal } from "../../../shared/components/Modal";

/**
 * Terminal and deliberately un-dismissable by backdrop or Escape: the room no
 * longer exists, so the only honest way out is back to the lobby.
 */
export function RoomClosedModal({
  open,
  reason,
  onLeave,
}: {
  open: boolean;
  reason: string;
  onLeave: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onLeave}
      title="This room has closed"
      subtitle={reason}
      footer={
        <button className="primary-button" type="button" onClick={onLeave} autoFocus>
          <DoorOpen size={16} /> Back to rooms
        </button>
      }
    >
      <p className="closed-copy">
        The host ended the session, so playback has stopped for everyone. Your uploaded
        music is still in your library.
      </p>
    </Modal>
  );
}
