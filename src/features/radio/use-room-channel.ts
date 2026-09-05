import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyRoomMutation,
  classifyRevision,
  isRoomMutationEvent,
  parseServerEvent,
  type ClientToServerEvent,
} from "../../../lib/radio/realtime";
import { radioKeys, type RoomSnapshot, type SessionUser } from "./queries";

type ClockSample = { offset: number; rtt: number };
export type RoomChannelStatus = "connecting" | "connected" | "reconnecting" | "closed";
export type RealtimeDiagnostics = {
  readonly rttMs: number;
  readonly serverOffsetMs: number;
  readonly reconnectCount: number;
  readonly roomRevision: number;
  readonly socketState: RoomChannelStatus;
};

const PING_INTERVAL = 10_000;
const MAX_BACKOFF = 8_000;
const SAMPLE_WINDOW = 8;

function send(socket: WebSocket, event: ClientToServerEvent) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(event));
}

function socketUrl(roomId: string) {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/api/radio/socket?room=${encodeURIComponent(roomId)}`;
}

/**
 * Live room feed. The Durable Object sends one snapshot when the socket opens,
 * then small revisioned mutations. TanStack Query remains the only owner of the
 * room data; this transport simply reduces each accepted event into that cache.
 */
export function useRoomChannel(roomId: string | null, sessionUser: SessionUser) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<RoomChannelStatus>("connecting");
  const [closedReason, setClosedReason] = useState<string | null>(null);
  // Once the room is gone, reconnecting would only 404 in a loop.
  const closed = useRef(false);
  const socketRef = useRef<WebSocket | null>(null);
  const samples = useRef<ClockSample[]>([]);
  const offset = useRef(0);
  const [diagnostics, setDiagnostics] = useState<RealtimeDiagnostics>({
    rttMs: 0,
    serverOffsetMs: 0,
    reconnectCount: 0,
    roomRevision: 0,
    socketState: "connecting",
  });
  const userRef = useRef(sessionUser);
  userRef.current = sessionUser;

  // Best-of-window: the lowest-latency probe carries the least one-way
  // uncertainty, the same reason NTP prefers its fastest exchange.
  const recordSample = useCallback((sample: ClockSample) => {
    const next = [...samples.current, sample].slice(-SAMPLE_WINDOW);
    samples.current = next;
    const best = next.reduce((fastest, item) => (item.rtt < fastest.rtt ? item : fastest), next[0]);
    offset.current = best.offset;
    setDiagnostics((current) => ({
      ...current,
      rttMs: best.rtt,
      serverOffsetMs: best.offset,
    }));
  }, []);

  const applySnapshot = useCallback(
    (snapshot: RoomSnapshot) => {
      const { room, serverTime } = snapshot;
      queryClient.setQueryData<RoomSnapshot>(radioKeys.room(room.id), (previous) => ({
        room,
        serverTime,
        user: previous?.user ?? userRef.current,
      }));
      setDiagnostics((current) => ({ ...current, roomRevision: room.revision }));
    },
    [queryClient],
  );

  useEffect(() => {
    if (!roomId) return;

    let disposed = false;
    let attempt = 0;
    let reconnectTimer: number | undefined;
    let pingTimer: number | undefined;

    const ping = (socket: WebSocket) => {
      send(socket, { type: "sync:ping", clientTimestamp: Date.now() });
    };

    const requestSnapshot = (socket: WebSocket, revision: number) => {
      send(socket, { type: "room:resync", revision });
    };

    const connect = () => {
      if (disposed) return;
      const nextStatus = attempt === 0 ? "connecting" : "reconnecting";
      setStatus(nextStatus);
      setDiagnostics((current) => ({ ...current, socketState: nextStatus }));
      const socket = new WebSocket(socketUrl(roomId));
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed) return;
        attempt = 0;
        samples.current = [];
        setConnected(true);
        setStatus("connected");
        setDiagnostics((current) => ({ ...current, socketState: "connected" }));
        // Burst a few probes so playback starts from an already-tight clock.
        ping(socket);
        window.setTimeout(() => ping(socket), 250);
        window.setTimeout(() => ping(socket), 600);
        pingTimer = window.setInterval(() => ping(socket), PING_INTERVAL);
      };

      socket.onmessage = (event) => {
        if (disposed || typeof event.data !== "string") return;
        let raw: unknown;
        try {
          raw = JSON.parse(event.data) as unknown;
        } catch {
          const previous = queryClient.getQueryData<RoomSnapshot>(radioKeys.room(roomId));
          requestSnapshot(socket, previous?.room.revision ?? 0);
          return;
        }
        const payload = parseServerEvent(raw);
        if (!payload) {
          const previous = queryClient.getQueryData<RoomSnapshot>(radioKeys.room(roomId));
          requestSnapshot(socket, previous?.room.revision ?? 0);
          return;
        }

        if (payload.type === "room:snapshot") {
          applySnapshot({
            room: payload.room,
            serverTime: payload.serverTime,
            user: userRef.current,
          });
          return;
        }

        if (payload.type === "sync:pong") {
          const rtt = Date.now() - payload.clientTimestamp;
          recordSample({
            rtt,
            offset: payload.serverTimestamp + rtt / 2 - Date.now(),
          });
          return;
        }

        if (payload.type === "room:closed") {
          closed.current = true;
          setClosedReason(payload.reason);
          setConnected(false);
          setStatus("closed");
          return;
        }

        if (payload.type === "protocol:error") return;

        if (isRoomMutationEvent(payload)) {
          const queryKey = radioKeys.room(roomId);
          const previous = queryClient.getQueryData<RoomSnapshot>(queryKey);
          if (!previous) {
            requestSnapshot(socket, 0);
            return;
          }
          // The actor may already hold this revision from its optimistic update.
          const disposition = classifyRevision(previous.room.revision, payload.revision);
          if (disposition === "duplicate") {
            setDiagnostics((current) => ({
              ...current,
              roomRevision: Math.max(current.roomRevision, payload.revision),
            }));
            return;
          }
          if (disposition === "gap") {
            requestSnapshot(socket, previous.room.revision);
            return;
          }
          try {
            const room = applyRoomMutation(previous.room, payload);
            queryClient.setQueryData<RoomSnapshot>(queryKey, {
              ...previous,
              room,
              serverTime: payload.serverTime,
            });
            setDiagnostics((current) => ({
              ...current,
              roomRevision: payload.revision,
            }));
          } catch {
            requestSnapshot(socket, previous.room.revision);
          }
        }
      };

      const scheduleReconnect = () => {
        setConnected(false);
        // A closed room is not a connectivity problem; stop retrying.
        if (closed.current) {
          window.clearInterval(pingTimer);
          return;
        }
        setStatus("reconnecting");
        setDiagnostics((current) => ({
          ...current,
          reconnectCount: current.reconnectCount + 1,
          socketState: "reconnecting",
        }));
        window.clearInterval(pingTimer);
        if (disposed) return;
        const baseDelay = Math.min(MAX_BACKOFF, 500 * 2 ** attempt++);
        const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
        reconnectTimer = window.setTimeout(connect, delay);
      };

      socket.onclose = scheduleReconnect;
      socket.onerror = () => socket.close();
    };

    const wakeUp = () => {
      if (closed.current) return;
      if (document.visibilityState !== "visible") return;
      const socket = socketRef.current;
      if (!socket || socket.readyState > WebSocket.OPEN) {
        window.clearTimeout(reconnectTimer);
        attempt = 0;
        connect();
      } else if (socket.readyState === WebSocket.OPEN) {
        // A backgrounded tab's timers are throttled, so re-establish the clock
        // and pull fresh state the moment it returns.
        ping(socket);
        const previous = queryClient.getQueryData<RoomSnapshot>(radioKeys.room(roomId));
        requestSnapshot(socket, previous?.room.revision ?? 0);
      }
    };

    connect();
    document.addEventListener("visibilitychange", wakeUp);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", wakeUp);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(pingTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      }
      setConnected(false);
    };
  }, [applySnapshot, queryClient, recordSample, roomId]);

  const serverNow = useCallback(() => Date.now() + offset.current, []);

  useEffect(() => {
    const development = (
      import.meta as ImportMeta & { readonly env?: { readonly DEV?: boolean } }
    ).env?.DEV;
    if (!development) return;
    const target = window as typeof window & {
      __LINER_RADIO_DIAGNOSTICS__?: RealtimeDiagnostics;
    };
    target.__LINER_RADIO_DIAGNOSTICS__ = diagnostics;
    return () => {
      if (target.__LINER_RADIO_DIAGNOSTICS__ === diagnostics) {
        delete target.__LINER_RADIO_DIAGNOSTICS__;
      }
    };
  }, [diagnostics]);

  return { connected, status, serverNow, diagnostics, closedReason };
}
