import type { RoomChannel } from "./room-channel";

export interface Env {
  readonly ASSETS: Fetcher;
  readonly DB: D1Database;
  readonly TRACKS: R2Bucket;
  readonly ROOMS: DurableObjectNamespace<RoomChannel>;
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL?: string;
}
