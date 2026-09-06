import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { RoomChannel } from "./worker/room-channel";

export default Alchemy.Stack(
  "LinerRadio",
  {
    providers: Cloudflare.providers(),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    const production = stage === "prod";
    const authSecret = yield* Alchemy.Random("BetterAuthSecret");

    // Keep the current production names so the first Alchemy deploy can adopt
    // the resources that Wrangler created. Other stages get isolated names.
    const database = yield* Cloudflare.D1.Database("Database", {
      name: production ? "liner-radio" : undefined,
      migrations: "./drizzle",
    }).pipe(RemovalPolicy.retain(production));

    const tracks = yield* Cloudflare.R2.Bucket("Tracks", {
      name: production ? "liner-radio-tracks" : undefined,
      // Preview uploads are disposable and must not prevent PR cleanup.
      forceDestroy: !production,
    }).pipe(RemovalPolicy.retain(production));

    const app = yield* Cloudflare.Website.Vite("App", {
      name: production ? "liner-radio" : undefined,
      main: "worker/index.ts",
      compatibility: {
        date: "2026-05-22",
        flags: ["nodejs_compat"],
      },
      assets: {
        notFoundHandling: "single-page-application",
        // The worker delegates page requests to ASSETS itself. Routing every
        // request through it also lets Alchemy's local module-runner WebSocket
        // reach the worker during development.
        runWorkerFirst: true,
      },
      dev: {
        host: "0.0.0.0",
        port: 5173,
      },
      env: {
        DB: database,
        TRACKS: tracks,
        ROOMS: Cloudflare.DurableObject<RoomChannel>("ROOMS", {
          className: "RoomChannel",
        }),
        BETTER_AUTH_SECRET: authSecret.text,
        // Every stage uses its own deployed or local origin for Better Auth.
        BETTER_AUTH_URL: Cloudflare.Workers.URL,
        ...(process.env.RESEND_API_KEY
          ? { RESEND_API_KEY: Redacted.make(process.env.RESEND_API_KEY) }
          : {}),
        ...(process.env.AUTH_EMAIL_FROM
          ? { AUTH_EMAIL_FROM: process.env.AUTH_EMAIL_FROM }
          : {}),
        ...(process.env.GOOGLE_CLIENT_ID
          ? { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID }
          : {}),
        ...(process.env.GOOGLE_CLIENT_SECRET
          ? { GOOGLE_CLIENT_SECRET: Redacted.make(process.env.GOOGLE_CLIENT_SECRET) }
          : {}),
      },
      observability: {
        enabled: true,
        logs: {
          enabled: true,
          invocationLogs: true,
        },
        traces: {
          enabled: true,
          headSamplingRate: production ? 1 : 0.2,
        },
      },
    });

    return {
      stage,
      url: app.url,
      workerName: app.workerName,
      databaseName: database.databaseName,
      bucketName: tracks.bucketName,
    };
  }),
);
