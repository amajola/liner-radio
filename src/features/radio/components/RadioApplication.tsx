import { MotionConfig } from "motion/react";
import { AppHeader } from "./AppHeader";
import { Lobby } from "./Lobby";
import { MobileNavigation } from "./MobileNavigation";
import { RoomView } from "./RoomView";
import { Toast } from "./Toast";
import { useUiStore } from "../../../stores/ui-store";
import type { SessionUser } from "../queries";

const spring = { type: "spring" as const, stiffness: 320, damping: 32 };

export function RadioApplication({ sessionUser }: { sessionUser: SessionUser }) {
  const activeRoomId = useUiStore((state) => state.activeRoomId);

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <div className="app-shell">
        <AppHeader userName={sessionUser.name} />
        <Toast />
        <main className="app-stage">
          {activeRoomId ? (
            <RoomView roomId={activeRoomId} sessionUser={sessionUser} />
          ) : (
            <Lobby userId={sessionUser.id} />
          )}
        </main>
        {activeRoomId && <MobileNavigation />}
      </div>
    </MotionConfig>
  );
}
