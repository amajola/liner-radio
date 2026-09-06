import { LogOut, Radio, UserRound } from "lucide-react";
import { useState } from "react";
import { useAuthMutations } from "../../auth/use-auth-mutations";
import { AccountModal } from "../../auth/components/AccountModal";
import { useUiStore } from "../../../stores/ui-store";
import type { SessionUser } from "../queries";

export function AppHeader({ user }: { user: SessionUser }) {
  const leaveRoom = useUiStore((state) => state.leaveRoom);
  const { signOut } = useAuthMutations();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <header className="app-header">
      <button className="brand" type="button" onClick={leaveRoom}>
        <Radio />
        <span>liner</span>
        <strong>RADIO</strong>
      </button>
      <div className="account-chip">
        <button className="account-profile" type="button" onClick={() => setAccountOpen(true)} aria-label="Edit profile">
          <span className="profile-avatar">
            {user.image ? <img src={user.image} alt="" /> : <UserRound size={16} />}
          </span>
          <span>{user.name}</span>
        </button>
        <button
          className="account-sign-out"
          type="button"
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          aria-label="Sign out"
        >
          <LogOut size={17} />
        </button>
      </div>
      <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} user={user} />
    </header>
  );
}
