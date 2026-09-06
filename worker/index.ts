import { createApiHandler, handleRoomSocket } from "./api";
import { createAuth } from "./auth";
import type { Env } from "./env";
import { makeHttpHandler, RequestFailure } from "./http";
import { handleTrackRequest } from "./tracks";

export { RoomChannel } from "./room-channel";

const handlers = new WeakMap<Env, ReturnType<typeof makeHttpHandler>>();

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Authentication emails use the current request's execution context so
    // delivery can finish after the response without extending its latency.
    if (url.pathname.startsWith("/api/auth/")) {
      return createAuth(request, env, context).handler(request);
    }

    // Handled before the Effect router because a 101 upgrade cannot be
    // reconstructed from a plain web Response.
    if (url.pathname === "/api/radio/socket") {
      return handleRoomSocket(request, env);
    }

    // Audio bodies stay outside the Effect adapter so cache writes can outlive
    // the response stream through the Worker's execution context.
    if (
      /^\/api\/tracks\/[a-f0-9]{32}\/audio$/.test(url.pathname) &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      try {
        const response = await handleTrackRequest(request, env, context);
        if (response) return response;
      } catch (cause) {
        const failure =
          cause instanceof RequestFailure
            ? cause
            : new RequestFailure({
                message: cause instanceof Error ? cause.message : "Audio could not be loaded.",
                status: 500,
              });
        return Response.json(
          { error: failure.message },
          { status: failure.status, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    let effectHandler = handlers.get(env);
    if (!effectHandler) {
      effectHandler = makeHttpHandler(env, createApiHandler(env));
      handlers.set(env, effectHandler);
    }

    if (url.pathname.startsWith("/api/")) {
      return effectHandler.handler(request);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
