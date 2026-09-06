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
      const result = await authClient.signUp.email({
        ...input,
        callbackURL: `${window.location.origin}/?verified=1`,
      });
      authFailure(result);
    },
    onSuccess: refreshSession,
  });

  const sendVerification = useMutation({
    mutationKey: [...authKeys.all, "send-verification"],
    mutationFn: async (email: string) => {
      const result = await authClient.sendVerificationEmail({
        email,
        callbackURL: `${window.location.origin}/?verified=1`,
      });
      authFailure(result);
    },
  });

  const requestPasswordReset = useMutation({
    mutationKey: [...authKeys.all, "request-password-reset"],
    mutationFn: async (email: string) => {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      authFailure(result);
    },
  });

  const resetPassword = useMutation({
    mutationKey: [...authKeys.all, "reset-password"],
    mutationFn: async (input: { token: string; newPassword: string }) => {
      const result = await authClient.resetPassword(input);
      authFailure(result);
    },
  });

  const socialSignIn = useMutation({
    mutationKey: [...authKeys.all, "social-sign-in"],
    mutationFn: async (provider: "google") => {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: window.location.origin,
        errorCallbackURL: `${window.location.origin}/?oauth_error=1`,
      });
      authFailure(result);
    },
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

  return {
    signIn,
    signUp,
    signOut,
    sendVerification,
    requestPasswordReset,
    resetPassword,
    socialSignIn,
  };
}
