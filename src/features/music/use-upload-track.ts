import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Track } from "../../../lib/radio/model";
import { apiRequest } from "../../shared/http";
import { useUiStore } from "../../stores/ui-store";
import { musicKeys } from "./queries";

export type UploadTrackInput = {
  ownerId: string;
  title: string;
  artist: string;
  duration: number;
  file: File;
  rightsConfirmed: boolean;
};

export function useUploadTrack() {
  const queryClient = useQueryClient();
  const showError = useUiStore((state) => state.showError);
  const showNotice = useUiStore((state) => state.showNotice);

  return useMutation({
    mutationKey: [...musicKeys.all, "upload"],
    mutationFn: ({ ownerId: _ownerId, ...input }: UploadTrackInput) => {
      const body = new FormData();
      body.set("title", input.title);
      body.set("artist", input.artist);
      body.set("duration", String(input.duration));
      body.set("rightsConfirmed", String(input.rightsConfirmed));
      body.set("file", input.file);
      return apiRequest<{ track: Track }>("/api/tracks", { method: "POST", body });
    },
    onSuccess: async (_data, variables) => {
      showNotice("Track uploaded to your library.");
      await queryClient.invalidateQueries({
        queryKey: musicKeys.library(variables.ownerId),
        exact: true,
      });
    },
    onError: (error) => showError(error.message),
  });
}
