import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth/minimal";
import { getDb } from "../db";
import * as schema from "../db/schema";
import { sendAuthEmail } from "./email";
import type { Env } from "./env";

export function createAuth(request: Request, env: Env, context?: ExecutionContext) {
  const requestOrigin = new URL(request.url).origin;
  const configuredURL = env.BETTER_AUTH_URL && new URL(env.BETTER_AUTH_URL);
  const baseURL =
    configuredURL && configuredURL.hostname !== "0.0.0.0"
      ? configuredURL.origin
      : requestOrigin;

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
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const delivery = sendAuthEmail(env, {
          to: user.email,
          subject: "Reset your Liner Radio password",
          heading: "Reset your password",
          copy: "Use this secure link to choose a new password for your Liner Radio account.",
          action: "Reset password",
          url,
        });
        if (context && env.RESEND_API_KEY && env.AUTH_EMAIL_FROM) context.waitUntil(delivery);
        else await delivery;
      },
    },
    emailVerification: {
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        const delivery = sendAuthEmail(env, {
          to: user.email,
          subject: "Verify your Liner Radio email",
          heading: "Verify your email",
          copy: "Confirm this email address to finish creating your account and enter the listening room.",
          action: "Verify email",
          url,
        });
        if (context && env.RESEND_API_KEY && env.AUTH_EMAIL_FROM) context.waitUntil(delivery);
        else await delivery;
      },
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              prompt: "select_account" as const,
            },
          }
        : {}),
    },
  });
}
