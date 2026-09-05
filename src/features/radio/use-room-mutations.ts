import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apply } from "../../../lib/radio/model";
import { postJson } from "../../shared/http";
import { useUiStore } from "../../stores/ui-store";
import {
  radioKeys,
  type RoomSnapshot,
  type RoomsResponse,
} from "./queries";

type CreateRoomInput = { name: string };
type JoinRoomInput = { roomId: string };
type CloseRoomInput = { roomId: string; reason?: "closed" | "left" };
type RenameRoomInput = { roomId: string; name: string };
export type RoomAction = {
  roomId: string;
  revision: number;
  type: string;
  [key: string]: unknown;
};

const optimisticActions = new Set([
  "rename",
  "request",
  "requestsOpen",
  "permission",
  "approve",
  "enqueue",
  "reject",
  "remove",
  "move",
  "next",
  "pause",
  "resume",
  "volume",
  "duck",
  "crossfade",
]);

export function useRoomMutations() {
  const queryClient = useQueryClient();
  const enterRoom = useUiStore((state) => state.enterRoom);
  const showError = useUiStore((state) => state.showError);

  const createRoom = useMutation({
    mutationKey: [...radioKeys.all, "create"],
    mutationFn: ({ name }: CreateRoomInput) =>
      postJson<RoomSnapshot>("/api/radio", { type: "create", name }),
    onSuccess: async (snapshot) => {
      queryClient.setQueryData(radioKeys.room(snapshot.room.id), snapshot);
      enterRoom(snapshot.room.id);
      await queryClient.invalidateQueries({ queryKey: radioKeys.rooms(), exact: true });
    },
    onError: (error) => showError(error.message),
  });

  const joinRoom = useMutation({
    mutationKey: [...radioKeys.all, "join"],
    mutationFn: ({ roomId }: JoinRoomInput) =>
      postJson<RoomSnapshot>("/api/radio", {
        type: "join",
        room: roomId.trim().toUpperCase(),
      }),
    onSuccess: (snapshot) => {
      queryClient.setQueryData(radioKeys.room(snapshot.room.id), snapshot);
      enterRoom(snapshot.room.id);
    },
    onError: (error) => showError(error.message),
  });

  const actOnRoom = useMutation({
    mutationKey: [...radioKeys.all, "action"],
    mutationFn: ({ roomId, ...action }: RoomAction) =>
      postJson<RoomSnapshot>("/api/radio", { ...action, room: roomId }),
    onMutate: async (variables) => {
      const queryKey = radioKeys.room(variables.roomId);
      await queryClient.cancelQueries({ queryKey, exact: true });
      const previous = queryClient.getQueryData<RoomSnapshot>(queryKey);

      if (previous && optimisticActions.has(variables.type)) {
        const optimisticRoom = apply(
          previous.room,
          previous.user.id,
          variables,
          Date.now(),
        );
        queryClient.setQueryData<RoomSnapshot>(queryKey, {
          ...previous,
          room: { ...optimisticRoom, revision: previous.room.revision + 1 },
        });
      }

      return { previous };
    },
    onError: (error, variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(radioKeys.room(variables.roomId), context.previous);
      }
      showError(error.message);
    },
    onSuccess: (snapshot) => {
      queryClient.setQueryData<RoomSnapshot>(
        radioKeys.room(snapshot.room.id),
        (current) =>
          current && current.room.revision > snapshot.room.revision ? current : snapshot,
      );
    },
    onSettled: async (_data, error, variables) => {
      // Successful writes already return the accepted revision and arrive as a
      // socket delta. Only failures need an authoritative HTTP recovery read.
      if (!error) return;
      await queryClient.invalidateQueries({
        queryKey: radioKeys.room(variables.roomId),
        exact: true,
      });
    },
  });

  // Renaming from the lobby, where the room is not open and its revision is
  // unknown. Omitting the revision skips the conflict check, which is safe: a
  // name is not derived from any state a stale client could be holding.
  const renameRoom = useMutation({
    mutationKey: [...radioKeys.all, "rename"],
    mutationFn: ({ roomId, name }: RenameRoomInput) =>
      postJson<RoomSnapshot>("/api/radio", { type: "rename", room: roomId, name }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: radioKeys.rooms(), exact: true });
    },
    onError: (error) => showError(error.message),
  });

  const closeRoom = useMutation({
    mutationKey: [...radioKeys.all, "close"],
    mutationFn: ({ roomId, reason = "closed" }: CloseRoomInput) =>
      postJson<{ closed: boolean; roomId: string }>("/api/radio", {
        type: "close",
        room: roomId,
        reason,
      }),
    onSuccess: async (_data, variables) => {
      // The room is gone: drop its cache entry rather than leaving a snapshot
      // that would render a room nobody can rejoin.
      queryClient.removeQueries({ queryKey: radioKeys.room(variables.roomId), exact: true });
      await queryClient.invalidateQueries({ queryKey: radioKeys.rooms(), exact: true });
    },
    onError: (error) => showError(error.message),
  });

  return {
    closeRoom,
    renameRoom,
    createRoom,
    joinRoom,
    actOnRoom,
    isWriting: createRoom.isPending || joinRoom.isPending || actOnRoom.isPending,
  };
}
