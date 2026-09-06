import { Settings } from "lucide-react";
import type { UseQueryResult } from "@tanstack/react-query";
import { EmptyState, ErrorState, LoadingState } from "../../../shared/components/AsyncState";
import { Modal } from "../../../shared/components/Modal";
import type { RoomsResponse, RoomSummary } from "../queries";

type ListProps = {
  rooms: UseQueryResult<RoomsResponse>;
  busy: boolean;
  onOpen: (room: RoomSummary) => void;
  onManage: (room: RoomSummary) => void;
};

/**
 * Shared by the desktop panel and the phone's modal so both render the same
 * rows, empty state and error handling.
 */
export function OwnedRoomsList({ rooms, busy, onOpen, onManage }: ListProps) {
  const owned = rooms.data?.rooms ?? [];

  return (
    <>
      {rooms.isPending && <LoadingState label="Loading your rooms…" />}
      {rooms.isError && !rooms.data && (
        <ErrorState message={rooms.error.message} retry={() => void rooms.refetch()} />
      )}
      {rooms.data && owned.length === 0 && (
        <EmptyState>Take the booth to make your first room.</EmptyState>
      )}
      <div className="owned-list">
        {owned.map((room) => (
          <div className="owned-row" key={room.id}>
            <button
              type="button"
              className="owned-open"
              disabled={busy}
              onClick={() => onOpen(room)}
            >
              <span>{room.name}</span>
              <strong>{room.id}</strong>
            </button>
            <button
              type="button"
              className="btn btn--quiet btn--sm btn--icon"
              onClick={() => onManage(room)}
              aria-label={`Manage ${room.name}`}
              title="Room settings"
            >
              <Settings size={16} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export function RoomsModal({
  open,
  onClose,
  ...list
}: ListProps & { open: boolean; onClose: () => void }) {
  const count = list.rooms.data?.rooms.length ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="tall"
      title="Your rooms"
      subtitle={`${count} room${count === 1 ? "" : "s"} you host`}
    >
      <OwnedRoomsList {...list} />
    </Modal>
  );
}
