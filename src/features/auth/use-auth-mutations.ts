import { useMutation, useQueryClient } from "@tanstack/react-query";
import { authClient } from "../../auth-client";
import { musicKeys } from "../music/queries";
import { radioKeys } from "../radio/queries";
import { authKeys } from "./queries";

function authFailure(result: { error: { message?: string } | null }) {
  if (result.error) throw new Error(result.error.message || "Authentication failed.");
}

export function useAuthMutations() {
  const queryClient = useQueryClient();

  const refreshSession = async () => {
    await queryClient.invalidateQueries({ queryKey: authKeys.session(), exact: true });
  };

  const signIn = useMutation({
    mutationKey: [...authKeys.all, "sign-in"],
    mutationFn: async (input: { email: string; password: string }) => {
      const result = await authClient.signIn.email(input);
      authFailure(result);
    },
    onSuccess: refreshSession,
  });

  const signUp = useMutation({
    mutationKey: [...authKeys.all, "sign-up"],
    mutationFn: async (input: { name: string; email: string; password: string }) => {
      const result = await authClient.signUp.email(input);
      authFailure(result);
    },
    onSuccess: refreshSession,
  });

  const signOut = useMutation({
    mutationKey: [...authKeys.all, "sign-out"],
    mutationFn: async () => {
      const result = await authClient.signOut();
      authFailure(result);
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: radioKeys.all });
      queryClient.removeQueries({ queryKey: musicKeys.all });
      await refreshSession();
    },
  });

  return { signIn, signUp, signOut };
}
