import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { getDb } from "../db";
import * as schema from "../db/schema";
import type { Env } from "./env";

export function createAuth(request: Request, env: Env) {
  const requestOrigin = new URL(request.url).origin;
  const baseURL = env.BETTER_AUTH_URL || requestOrigin;

  return betterAuth({
    appName: "Liner Radio",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [baseURL, requestOrigin],
    database: drizzleAdapter(getDb(env.DB), {
      provider: "sqlite",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
  });
}
