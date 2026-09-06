import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Settings, UserPlus } from "lucide-react";
import { useState } from "react";
import { useSynchronizedPlayer } from "../../music/use-synchronized-player";
import { ErrorState, LoadingState, QueryFreshness } from "../../../shared/components/AsyncState";
import { useUiStore } from "../../../stores/ui-store";
import { roomQueryOptions, type SessionUser } from "../queries";
import { useRoomChannel } from "../use-room-channel";
import { useRoomMutations } from "../use-room-mutations";
import { MixerModal } from "./MixerModal";
import { RoomClosedModal } from "./RoomClosedModal";
import { RoomSettingsModal } from "./RoomSettingsModal";
import { NowPanel } from "./NowPanel";
import { QueuePanel } from "./QueuePanel";
import { SidePanel } from "./SidePanel";

export function RoomView({ roomId, sessionUser }: { roomId: string; sessionUser: SessionUser }) {
  const channel = useRoomChannel(roomId, sessionUser);
  const snapshot = useQuery(roomQueryOptions(roomId, channel.connected));
  const mobileView = useUiStore((state) => state.mobileView);
  const leaveRoom = useUiStore((state) => state.leaveRoom);
  const showNotice = useUiStore((state) => state.showNotice);
  const { actOnRoom, closeRoom } = useRoomMutations();
  const [mixerOpen, setMixerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const player = useSynchronizedPlayer(snapshot.data?.room, channel.serverNow);

  if (snapshot.isPending) return <LoadingState label="Tuning into the room…" />;
  if (snapshot.isError && !snapshot.data) {
    return <ErrorState message={snapshot.error.message} retry={() => void snapshot.refetch()} />;
  }
  if (!snapshot.data) return null;

  const { room } = snapshot.data;
  const isHost = room.members.find((member) => member.id === sessionUser.id)?.role === "host";
  const busy = actOnRoom.isPending;

  function act(type: string, extra: Record<string, unknown> = {}) {
    actOnRoom.mutate({
      roomId: room.id,
      revision: room.revision,
      type,
      ...extra,
    });
  }

  async function copyInvite() {
    const invitation = `${location.origin}/?room=${room.id}`;
    try {
      await navigator.clipboard.writeText(invitation);
      showNotice("Room invite copied.");
    } catch {
      showNotice(`Room code: ${room.id}`);
    }
  }

  function exitRoom() {
    player.disconnectRoom();
    // The host is the room: when they walk out there is no programme left to
    // run, so the room closes for everyone instead of stranding listeners.
    if (isHost) {
      closeRoom.mutate(
        { roomId: room.id, reason: "left" },
        { onSettled: () => leaveRoom() },
      );
      return;
    }
    leaveRoom();
  }

  function deleteRoom() {
    player.disconnectRoom();
    closeRoom.mutate(
      { roomId: room.id, reason: "closed" },
      {
        onSuccess: () => {
          setSettingsOpen(false);
          leaveRoom();
        },
      },
    );
  }

  function leaveClosedRoom() {
    player.disconnectRoom();
    leaveRoom();
  }

  return (
    <div className="room-shell">
      <div className="room-bar">
        <button className="btn btn--quiet btn--sm room-exit" type="button" onClick={exitRoom}>
          <ArrowLeft size={17} /> Rooms
        </button>
        <div className="room-identity">
          <strong>{room.name}</strong>
          <span>{room.members.length} listening</span>
          <QueryFreshness
            isFetching={snapshot.isFetching}
            isStale={snapshot.isStale}
            hasError={snapshot.isError}
          />
        </div>
        {/* Sharing the room and running it are the two things a host reaches
            for, so they are full buttons with visible labels rather than bare
            icons tucked into a corner. */}
        <div className="room-bar-actions">
          <button
            className="btn btn--accent"
            type="button"
            onClick={() => void copyInvite()}
          >
            <UserPlus size={17} /> Invite
          </button>
          {isHost && (
            <button
              className="btn btn--secondary"
              type="button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={17} /> Settings
            </button>
          )}
        </div>
      </div>

      {channel.status === "reconnecting" && (
        <div className="callout callout--warning stale-data-banner" role="status">
          Live link reconnecting. Falling back to periodic refresh.
        </div>
      )}

      <div className={`room-grid view-${mobileView}`}>
        <NowPanel
          room={room}
          serverNow={channel.serverNow}
          connectionStatus={player.status}
          connectionError={player.connectionError}
          busy={busy}
          isHost={isHost}
          tuneIn={player.tuneIn}
          openMixer={() => setMixerOpen(true)}
          act={act}
        />
        <QueuePanel room={room} isHost={isHost} busy={busy} act={act} />
        <SidePanel room={room} userId={sessionUser.id} busy={busy} isHost={isHost} act={act} />
      </div>

      <RoomSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        roomId={room.id}
        roomName={room.name}
        listeners={room.members.length}
        busy={busy}
        deleting={closeRoom.isPending}
        onRename={(name) => act("rename", { name })}
        onDelete={deleteRoom}
      />

      <RoomClosedModal
        open={Boolean(channel.closedReason)}
        reason={channel.closedReason ?? ""}
        onLeave={leaveClosedRoom}
      />

      <MixerModal
        open={mixerOpen}
        onClose={() => setMixerOpen(false)}
        room={room}
        isHost={isHost}
        busy={busy}
        act={act}
        localAction={player.localAction}
      />
    </div>
  );
}
