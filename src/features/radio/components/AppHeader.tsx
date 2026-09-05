import { LogOut, Radio } from "lucide-react";
import { useAuthMutations } from "../../auth/use-auth-mutations";
import { useUiStore } from "../../../stores/ui-store";

export function AppHeader({ userName }: { userName: string }) {
  const leaveRoom = useUiStore((state) => state.leaveRoom);
  const { signOut } = useAuthMutations();

  return (
    <header className="app-header">
      <button className="brand" type="button" onClick={leaveRoom}>
        <Radio />
        <span>liner</span>
        <strong>RADIO</strong>
      </button>
      <div className="account-chip">
        <span>{userName}</span>
        <button
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          aria-label="Sign out"
        >
          <LogOut size={17} />
        </button>
      </div>
    </header>
  );
}
