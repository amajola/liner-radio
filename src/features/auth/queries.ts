import { queryOptions } from "@tanstack/react-query";
import { authClient } from "../../auth-client";

export const authKeys = {
  all: ["auth"] as const,
  session: () => [...authKeys.all, "session"] as const,
};

export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof authClient.getSession>>["data"]
>;

export const sessionQueryOptions = () =>
  queryOptions({
    queryKey: authKeys.session(),
    queryFn: async (): Promise<AuthSession | null> => {
      const result = await authClient.getSession();
      if (result.error) throw new Error(result.error.message || "Unable to read your session.");
      return result.data;
    },
    staleTime: 30_000,
  });
