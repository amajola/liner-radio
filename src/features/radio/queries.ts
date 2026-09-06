import { queryOptions } from "@tanstack/react-query";
import type { Room } from "../../../lib/radio/model";
import { apiRequest } from "../../shared/http";

export type SessionUser = {
  id: string;
  name: string;
  email?: string;
  emailVerified?: boolean;
  image?: string | null;
};
export type RoomSummary = { id: string; name: string };
export type RoomsResponse = {
  user: SessionUser;
  rooms: RoomSummary[];
};
export type RoomSnapshot = {
  room: Room;
  user: SessionUser;
  serverTime: number;
};

export const radioKeys = {
  all: ["radio"] as const,
  rooms: () => ["radio", "rooms"] as const,
  room: (roomId: string) => ["radio", "room", roomId] as const,
};

export function roomsQueryOptions() {
  return queryOptions({
    queryKey: radioKeys.rooms(),
    queryFn: () => apiRequest<RoomsResponse>("/api/radio"),
    staleTime: 30_000,
  });
}

// `live` means a room socket is delivering pushes, so polling stands down and
// only returns as the fallback when that socket drops.
export function roomQueryOptions(roomId: string, live = false) {
  return queryOptions({
    queryKey: radioKeys.room(roomId),
    queryFn: () =>
      apiRequest<RoomSnapshot>(`/api/radio?room=${encodeURIComponent(roomId)}`),
    enabled: Boolean(roomId),
    staleTime: live ? 30_000 : 1_500,
    refetchInterval: live ? false : 2_000,
  });
}
