import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { ErrorState } from "../../../shared/components/AsyncState";
import { RadioApplication } from "../../radio/components/RadioApplication";
import { sessionQueryOptions } from "../queries";
import { AuthScreen } from "./AuthScreen";

export function AuthGate() {
  const session = useQuery(sessionQueryOptions());

  if (session.isPending) {
    return (
      <div className="boot-screen" role="status">
        <Radio size={36} />
        <span>Opening the room…</span>
      </div>
    );
  }

  if (session.isError) {
    return (
      <div className="boot-screen">
        <ErrorState message={session.error.message} retry={() => void session.refetch()} />
      </div>
    );
  }

  if (!session.data) return <AuthScreen />;
  return <RadioApplication sessionUser={session.data.user} />;
}
