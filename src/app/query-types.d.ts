import "@tanstack/react-query";

type AppQueryKey = readonly [
  "auth" | "radio" | "music",
  ...ReadonlyArray<unknown>,
];

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: Error;
    queryKey: AppQueryKey;
    mutationKey: AppQueryKey;
  }
}
