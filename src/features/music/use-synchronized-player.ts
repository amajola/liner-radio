import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Room, Track } from "../../../lib/radio/model";
import { useUiStore } from "../../stores/ui-store";
import { trackPlaybackQueryOptions } from "./queries";

type Deck = { audio: HTMLAudioElement; mix: number };
export type PlayerStatus = "idle" | "connecting" | "live" | "blocked" | "error";

// Past this the listener is audibly behind, so take the seek and the glitch.
const HARD_SEEK_SECONDS = 1;
// Under this, correcting is more disruptive than the error itself.
const SOFT_BAND_SECONDS = 0.12;
// Kept small enough to be inaudible on music while still closing a gap fast.
const MAX_RATE_TRIM = 0.025;
const DRIFT_INTERVAL = 1_000;
// A seek throws away the buffer and starts a new range request. On a mobile
// link that request is slow enough to stall again, which grows the drift, which
// seeks again. Seeking at most this often breaks that loop; between seeks the
// rate trim closes the gap instead. The window has to be longer than the trim
// needs to absorb a second of drift (a second at 2.5% takes ~40s), otherwise
// the cooldown expires mid-recovery and the loop simply runs slower.
const MIN_SECONDS_BETWEEN_SEEKS = 45;
// After the element reports it ran dry, give the network a moment before
// deciding the listener is behind: mid-rebuffer, drift is expected.
const STARVED_GRACE_MS = 2_500;
// Far enough out of position that staying smooth no longer matters, e.g. after
// the tab was backgrounded. Seek regardless of the cooldown.
const RECOVERY_SEEK_SECONDS = 8;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const clampTo = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function waitForMetadata(audio: HTMLAudioElement, signal: AbortSignal) {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error("The audio took too long to load.")), 15_000);
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", ready);
      audio.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("This uploaded audio could not be played."));
    const aborted = () => finish(new DOMException("Audio connection cancelled.", "AbortError"));
    audio.addEventListener("loadedmetadata", ready, { once: true });
    audio.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

const isAutoplayBlock = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "NotAllowedError";

export function useSynchronizedPlayer(room: Room | undefined, serverNow: () => number) {
  const queryClient = useQueryClient();
  const showError = useUiStore((state) => state.showError);
  const roomRef = useRef<Room | undefined>(room);
  const serverNowRef = useRef(serverNow);
  const decks = useRef<[Deck, Deck] | null>(null);
  const activeDeck = useRef(0);
  const loadedKey = useRef("");
  const live = useRef(false);
  const syncing = useRef(false);
  const syncAgain = useRef(false);
  const syncGeneration = useRef(0);
  const syncAbort = useRef<AbortController | null>(null);
  const masterLevel = useRef(0.8);
  const levelAnimation = useRef<number | null>(null);
  const mixAnimation = useRef<number | null>(null);
  const lastStarvedAt = useRef(0);
  const lastSeekAt = useRef(0);
  const preloadAudio = useRef<HTMLAudioElement | null>(null);
  const preloadAbort = useRef<AbortController | null>(null);
  const autoTried = useRef(false);
  const [status, setStatus] = useState<PlayerStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  roomRef.current = room;
  serverNowRef.current = serverNow;

  const ensureDecks = useCallback(() => {
    if (!decks.current) {
      const first = new Audio();
      const second = new Audio();
      first.preload = "auto";
      second.preload = "auto";
      decks.current = [
        { audio: first, mix: 1 },
        { audio: second, mix: 0 },
      ];
    }
    return decks.current;
  }, []);

  const applyLevels = useCallback(() => {
    for (const deck of ensureDecks()) {
      deck.audio.volume = clamp(masterLevel.current * deck.mix);
    }
  }, [ensureDecks]);

  const animateMasterLevel = useCallback(
    (target: number, duration = 350) => {
      if (levelAnimation.current !== null) cancelAnimationFrame(levelAnimation.current);
      const from = masterLevel.current;
      const started = performance.now();
      const frame = (now: number) => {
        const progress = clamp((now - started) / duration);
        masterLevel.current = from + (target - from) * progress;
        applyLevels();
        if (progress < 1) levelAnimation.current = requestAnimationFrame(frame);
        else levelAnimation.current = null;
      };
      levelAnimation.current = requestAnimationFrame(frame);
    },
    [applyLevels],
  );

  const stopDeck = useCallback((deck: Deck) => {
    deck.audio.pause();
    deck.audio.removeAttribute("src");
    deck.audio.load();
    deck.audio.playbackRate = 1;
    deck.mix = 0;
  }, []);

  const crossfade = useCallback(
    (from: Deck, to: Deck, duration: number, initialProgress: number) => {
      if (mixAnimation.current !== null) cancelAnimationFrame(mixAnimation.current);
      const started = performance.now();
      const remaining = duration * (1 - initialProgress);
      if (remaining <= 0) {
        to.mix = 1;
        applyLevels();
        stopDeck(from);
        return;
      }
      const frame = (now: number) => {
        const progress = initialProgress + (1 - initialProgress) * clamp((now - started) / remaining);
        from.mix = 1 - progress;
        to.mix = progress;
        applyLevels();
        if (progress < 1) mixAnimation.current = requestAnimationFrame(frame);
        else {
          mixAnimation.current = null;
          stopDeck(from);
        }
      };
      mixAnimation.current = requestAnimationFrame(frame);
    },
    [applyLevels, stopDeck],
  );

  const loadTrack = useCallback(
    async (deck: Deck, track: Track, signal: AbortSignal) => {
      const grant = await queryClient.fetchQuery(trackPlaybackQueryOptions(track.id));
      if (signal.aborted) {
        throw new DOMException("Audio connection cancelled.", "AbortError");
      }
      const source = new URL(grant.url, location.origin).href;
      if (deck.audio.src !== source) {
        deck.audio.src = source;
        deck.audio.load();
      }
      await waitForMetadata(deck.audio, signal);
    },
    [queryClient],
  );

  // Where the room says the needle should be, in track seconds, using the
  // socket-corrected clock rather than this device's wall clock.
  const expectedPosition = useCallback((current: Room) => {
    if (!current.current) return 0;
    const elapsed =
      current.playing && current.startedAt
        ? (serverNowRef.current() - current.startedAt) / 1_000
        : 0;
    return Math.max(0, current.offset + elapsed);
  }, []);

  const seekTarget = useCallback((current: Room, position: number) => {
    const duration = current.current?.duration ?? 0;
    return Math.min(position, Math.max(0, duration - 0.1));
  }, []);

  /**
   * Nudge rather than seek. A late device speeds up by at most 2.5% until it
   * catches the room, which is inaudible on music where a hard seek is not.
   */
  const correctDrift = useCallback(() => {
    const current = roomRef.current;
    if (!live.current || !current?.current || !current.playing) return;
    if (loadedKey.current !== current.current.key) return;

    const deck = decks.current?.[activeDeck.current];
    if (!deck || deck.audio.paused) return;
    // HAVE_CURRENT_DATA only means the current frame exists. A deck that has
    // run dry sits exactly there, so requiring "can play forward" is what
    // actually distinguishes a lagging listener from one that is rebuffering.
    if (deck.audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;

    const expected = expectedPosition(current);
    if (expected >= current.current.duration) return;

    const now = performance.now();
    const drift = deck.audio.currentTime - expected;
    if (Math.abs(drift) > HARD_SEEK_SECONDS) {
      const rebuffering = now - lastStarvedAt.current < STARVED_GRACE_MS;
      const seekedRecently = now - lastSeekAt.current < MIN_SECONDS_BETWEEN_SEEKS * 1_000;
      if (Math.abs(drift) <= RECOVERY_SEEK_SECONDS && (rebuffering || seekedRecently)) {
        // Trim the rate instead of seeking: slower to converge, but it keeps
        // the buffer we already have rather than starting the stall again.
        deck.audio.playbackRate = clampTo(1 - drift * 0.05, 1 - MAX_RATE_TRIM, 1 + MAX_RATE_TRIM);
        return;
      }
      lastSeekAt.current = now;
      deck.audio.currentTime = seekTarget(current, expected);
      deck.audio.playbackRate = 1;
    } else if (Math.abs(drift) > SOFT_BAND_SECONDS) {
      deck.audio.playbackRate = clampTo(1 - drift * 0.05, 1 - MAX_RATE_TRIM, 1 + MAX_RATE_TRIM);
    } else if (deck.audio.playbackRate !== 1) {
      deck.audio.playbackRate = 1;
    }
  }, [expectedPosition, seekTarget]);

  const sync = useCallback(async (userInitiated = false) => {
    const currentRoom = roomRef.current;
    if (!live.current) return;
    if (syncing.current) {
      syncAgain.current = true;
      return;
    }
    const generation = syncGeneration.current;
    const controller = new AbortController();
    syncAbort.current = controller;
    const players = ensureDecks();
    syncing.current = true;

    try {
      if (!currentRoom?.current) {
        players.forEach(stopDeck);
        loadedKey.current = "";
        setStatus("idle");
        return;
      }

      const expected = expectedPosition(currentRoom);

      if (loadedKey.current !== currentRoom.current.key) {
        const hadPrevious = Boolean(loadedKey.current);
        const fromIndex = activeDeck.current;
        const toIndex = hadPrevious ? (fromIndex === 0 ? 1 : 0) : fromIndex;
        const from = players[fromIndex];
        const to = players[toIndex];
        const loading = loadTrack(to, currentRoom.current, controller.signal);
        // Start play while the click still carries browser user activation.
        // Waiting for a readiness event first makes Safari/Chrome treat the later call
        // as autoplay, which is why a second or third click used to be needed.
        const gesturePlay =
          userInitiated && currentRoom.playing
            ? to.audio.play().then(
                () => ({ ok: true as const }),
                (cause: unknown) => ({ ok: false as const, cause }),
              )
            : null;
        await loading;
        if (generation !== syncGeneration.current || !live.current) return;
        to.audio.currentTime = seekTarget(currentRoom, expected);
        to.audio.playbackRate = 1;
        to.mix = hadPrevious ? 0 : 1;
        applyLevels();
        if (currentRoom.playing) {
          if (gesturePlay) {
            const result = await gesturePlay;
            if (generation !== syncGeneration.current || !live.current) return;
            if (!result.ok) throw result.cause;
          } else await to.audio.play();
        }
        else to.audio.pause();

        if (hadPrevious && from !== to && currentRoom.playing) {
          const duration = currentRoom.crossfadeSeconds * 1_000;
          const elapsed = currentRoom.startedAt
            ? Math.max(0, serverNowRef.current() - currentRoom.startedAt)
            : duration;
          const progress = duration > 0 ? clamp(elapsed / duration) : 1;
          from.mix = 1 - progress;
          to.mix = progress;
          crossfade(from, to, duration, progress);
        } else if (from !== to) stopDeck(from);

        activeDeck.current = toIndex;
        loadedKey.current = currentRoom.current.key;
        setConnectionError(null);
        setStatus("live");
      } else {
        const active = players[activeDeck.current].audio;
        if (currentRoom.playing) {
          const gesturePlay = userInitiated
            ? active.play().then(
                () => ({ ok: true as const }),
                (cause: unknown) => ({ ok: false as const, cause }),
              )
            : null;
          if (Math.abs(active.currentTime - expected) > HARD_SEEK_SECONDS) {
            active.currentTime = seekTarget(currentRoom, expected);
          }
          if (gesturePlay) {
            const result = await gesturePlay;
            if (generation !== syncGeneration.current || !live.current) return;
            if (!result.ok) throw result.cause;
          } else await active.play();
          setConnectionError(null);
          setStatus("live");
        } else {
          if (mixAnimation.current !== null) cancelAnimationFrame(mixAnimation.current);
          mixAnimation.current = null;
          players.forEach((deck, index) => {
            if (index === activeDeck.current) {
              deck.audio.pause();
              deck.audio.currentTime = seekTarget(currentRoom, expected);
              deck.mix = 1;
            } else stopDeck(deck);
          });
          applyLevels();
        }
      }
    } catch (cause) {
      if (generation !== syncGeneration.current) return;
      if (isAutoplayBlock(cause)) {
        // The device is cued and correct, it just needs one tap to make sound.
        setConnectionError(null);
        setStatus("blocked");
      } else {
        live.current = false;
        const message = cause instanceof Error ? cause.message : "The uploaded audio could not play.";
        setConnectionError(message);
        setStatus("error");
        showError(message);
      }
    } finally {
      if (generation !== syncGeneration.current) return;
      syncing.current = false;
      if (syncAbort.current === controller) syncAbort.current = null;
      if (syncAgain.current) {
        syncAgain.current = false;
        void sync();
      }
    }
  }, [
    applyLevels,
    crossfade,
    ensureDecks,
    expectedPosition,
    loadTrack,
    seekTarget,
    showError,
    stopDeck,
  ]);

  useEffect(() => {
    const target = clamp((room?.volume ?? 0.8) * (room?.ducked ? 0.18 : 1));
    animateMasterLevel(target, room?.ducked ? 450 : 300);
  }, [animateMasterLevel, room?.ducked, room?.volume]);

  // Resolve the current grant as soon as the room snapshot arrives. This runs
  // before a listener taps Tune in, and TanStack Query shares the in-flight
  // request with loadTrack so it never creates duplicate server state.
  useEffect(() => {
    if (!room?.current) return;
    void queryClient.prefetchQuery(trackPlaybackQueryOptions(room.current.id));
  }, [queryClient, room?.current?.id]);

  const nextTrack = room?.queue[0];
  useEffect(() => {
    preloadAbort.current?.abort();
    preloadAbort.current = null;
    const previous = preloadAudio.current;
    preloadAudio.current = null;
    if (previous) {
      previous.pause();
      previous.removeAttribute("src");
      previous.load();
    }

    if (!nextTrack || nextTrack.key === room?.current?.key) return;
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (connection?.saveData) return;
    // On a slow link the next song is not worth the bandwidth it would take
    // from the one currently playing.
    if (connection?.effectiveType && /(^|-)2g$|^3g$/.test(connection.effectiveType)) return;

    const controller = new AbortController();
    preloadAbort.current = controller;

    // Wait until the current track is comfortably buffered. Downloading the
    // next one over a mobile link while this one is still filling is what makes
    // playback choppy on connect.
    let waitTimer: number | undefined;
    const startWhenCurrentIsSafe = (attempt = 0) => {
      if (controller.signal.aborted) return;
      const deck = decks.current?.[activeDeck.current];
      const ready = deck && deck.audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA;
      // Give up waiting eventually; a track that never reports "enough" should
      // not block preloading forever.
      if (!ready && attempt < 30) {
        waitTimer = window.setTimeout(() => startWhenCurrentIsSafe(attempt + 1), 1_000);
        return;
      }
      void queryClient
        .fetchQuery(trackPlaybackQueryOptions(nextTrack.id))
        .then((grant) => {
          if (controller.signal.aborted) return;
          const audio = new Audio();
          audio.preload = "auto";
          audio.src = new URL(grant.url, location.origin).href;
          audio.load();
          preloadAudio.current = audio;
        })
        // Preloading is opportunistic. A failure is retried normally if the song
        // becomes current and must never interrupt music that is already playing.
        .catch(() => undefined);
    };
    startWhenCurrentIsSafe();

    return () => {
      controller.abort();
      window.clearTimeout(waitTimer);
      if (preloadAbort.current === controller) preloadAbort.current = null;
    };
  }, [nextTrack?.id, nextTrack?.key, queryClient, room?.current?.key]);

  useEffect(() => {
    void sync();
  }, [room?.revision, sync]);

  // Every device that lands in a room tries to join the programme on its own.
  // Browsers only allow that with prior user activation, so a refusal is
  // surfaced as `blocked` for a one-tap recovery instead of silence.
  useEffect(() => {
    if (autoTried.current || !room?.current || live.current) return;
    autoTried.current = true;
    live.current = true;
    setConnectionError(null);
    setStatus("connecting");
    void sync();
  }, [room?.current, sync]);

  useEffect(() => {
    const interval = window.setInterval(correctDrift, DRIFT_INTERVAL);
    return () => window.clearInterval(interval);
  }, [correctDrift]);

  useEffect(() => {
    const players = ensureDecks();
    const resync = () => void sync();
    const starved = () => {
      lastStarvedAt.current = performance.now();
    };
    for (const deck of players) {
      deck.audio.addEventListener("ended", resync);
      deck.audio.addEventListener("playing", correctDrift);
      deck.audio.addEventListener("waiting", starved);
      deck.audio.addEventListener("stalled", starved);
    }
    return () => {
      for (const deck of players) {
        deck.audio.removeEventListener("ended", resync);
        deck.audio.removeEventListener("playing", correctDrift);
        deck.audio.removeEventListener("waiting", starved);
        deck.audio.removeEventListener("stalled", starved);
      }
    };
  }, [correctDrift, ensureDecks, sync]);

  useEffect(
    () => () => {
      syncGeneration.current += 1;
      syncAbort.current?.abort();
      syncAbort.current = null;
      syncing.current = false;
      syncAgain.current = false;
      live.current = false;
      autoTried.current = false;
      loadedKey.current = "";
      preloadAbort.current?.abort();
      preloadAbort.current = null;
      const preloaded = preloadAudio.current;
      preloadAudio.current = null;
      if (preloaded) {
        preloaded.pause();
        preloaded.removeAttribute("src");
        preloaded.load();
      }
      if (levelAnimation.current !== null) cancelAnimationFrame(levelAnimation.current);
      if (mixAnimation.current !== null) cancelAnimationFrame(mixAnimation.current);
      const players = decks.current;
      decks.current = null;
      players?.forEach(stopDeck);
    },
    [stopDeck],
  );

  async function tuneIn() {
    if (syncing.current || status === "connecting") return;
    live.current = true;
    autoTried.current = true;
    setConnectionError(null);
    setStatus("connecting");
    await sync(true);
  }

  function localAction(action: "play" | "pause") {
    if (action === "play") {
      void tuneIn();
      return;
    }
    syncGeneration.current += 1;
    syncAbort.current?.abort();
    syncAbort.current = null;
    syncing.current = false;
    syncAgain.current = false;
    live.current = false;
    setStatus("idle");
    ensureDecks().forEach((deck) => deck.audio.pause());
  }

  function disconnectRoom() {
    syncGeneration.current += 1;
    syncAbort.current?.abort();
    syncAbort.current = null;
    syncing.current = false;
    syncAgain.current = false;
    live.current = false;
    autoTried.current = false;
    loadedKey.current = "";
    setConnectionError(null);
    setStatus("idle");
    ensureDecks().forEach(stopDeck);
  }

  return {
    status,
    connectionError,
    tuneIn,
    localAction,
    disconnectRoom,
  };
}
