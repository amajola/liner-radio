import { Data, Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http";
import type { Env } from "./env";

export class RequestFailure extends Data.TaggedError("RequestFailure")<{
  readonly message: string;
  readonly status: number;
}> {}

export type ApiHandler = (request: Request) => Promise<Response>;

function responseFromFailure(error: unknown) {
  const failure =
    error instanceof RequestFailure
      ? error
      : new RequestFailure({
          message: error instanceof Error ? error.message : "Something went wrong.",
          status: 500,
        });

  return HttpServerResponse.jsonUnsafe(
    { error: failure.message },
    {
      status: failure.status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export function makeHttpHandler(env: Env, dispatch: ApiHandler) {
  const routes = HttpRouter.add("*", "/api/*", (request) =>
    Effect.tryPromise({
      try: async () => {
        const source = request.source;
        if (!(source instanceof Request)) {
          throw new RequestFailure({
            message: "Unsupported request source.",
            status: 500,
          });
        }
        return HttpServerResponse.fromWeb(await dispatch(source));
      },
      catch: (error) => error,
    }).pipe(
      Effect.match({
        onFailure: responseFromFailure,
        onSuccess: (response) => response,
      }),
    ),
  );

  const app = routes.pipe(Layer.provide(HttpServer.layerServices));
  return HttpRouter.toWebHandler(app, { disableLogger: true });
}
