// The single place environment configuration is read and validated.
// Next.js (and `node --env-file=.env` for scripts) loads .env; this module
// validates it with zod and every other file imports `env` from here —
// never process.env directly.

import { z } from "zod";
import { normalizeEmail } from "./email.ts";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // 127.0.0.1, not localhost: the compose port bind is IPv4-only, and
  // localhost can resolve to ::1 first and refuse the connection.
  DATABASE_URL: z.string().default("postgres://chiangpai:chiangpai@127.0.0.1:5566/chiangpai"),

  /** Pino level. Defaults to info in production, debug otherwise (lib/logger.ts). */
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional(),

  // Required everywhere — sessions are HMAC-signed with it, so there is no
  // safe fallback value. Build machines export a placeholder (see Dockerfile
  // and ci.yml); the running server gets its real value from .env.
  AUTH_SECRET: z
    .string()
    .min(16, "AUTH_SECRET is required — generate one with `openssl rand -base64 32`"),
  /**
   * Public base URL. Google callbacks, cookie `secure`, and the passkey rp id
   * all derive from it. Unlike DATABASE_URL above, this one says `localhost`
   * and must not be "made consistent" with 127.0.0.1: a relying party id has
   * to be a domain name, and no browser will register a passkey against an IP
   * address (lib/auth.ts, passkeysConfigured).
   */
  AUTH_URL: z
    .url()
    .default("http://localhost:3000")
    .transform((u) => u.replace(/\/+$/, "")),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),

  /** Local development only: enables a passwordless fake login. Never set in production. */
  AUTH_DEV_LOGIN: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),

  /** Comma-separated emails that may always join (bootstraps the group). */
  FOUNDING_MEMBERS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => normalizeEmail(e))
        .filter(Boolean),
    ),

  /** Maximum total exposure per member per market, in pies. */
  MAX_STAKE_PIES: z.coerce.number().int().positive().default(10),

  /** Resolved markets required before a member appears in the ranked leaderboard. */
  RANKED_MIN_RESOLVED: z.coerce.number().int().positive().default(5),

  // Optional LLM used to polish market drafts before publishing.
  // Any Anthropic-compatible endpoint works (e.g. MiniMax M3 via its
  // Anthropic-style API). The feature is hidden unless URL + key are set.
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("MiniMax-M3"),
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;
