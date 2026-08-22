// The single place environment configuration is read and validated.
// Next.js (and `node --env-file=.env` for scripts) loads .env; this module
// validates it with zod and every other file imports `env` from here —
// never process.env directly.

import { z } from "zod";

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

  /** Resolved markets required before a member appears in the ranked leaderboard. */
  RANKED_MIN_RESOLVED: z.coerce.number().int().positive().default(5),

  // Optional LLM used to polish market drafts before publishing.
  // Any Anthropic-compatible endpoint works (e.g. MiniMax M3 via its
  // Anthropic-style API). The feature is hidden unless URL + key are set.
  LLM_BASE_URL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("MiniMax-M3"),

  // Optional voice for the talk page, for phones with no voice of their own.
  // Unset, the page still works: it types, it reads, and the device speaks if
  // it can.
  SPEECH_BASE_URL: z.string().optional(),
  SPEECH_API_KEY: z.string().optional(),
  SPEECH_TTS_MODEL: z.string().default("tts-1"),
  /** The `openai` flavor's one voice; it has no notion of who is speaking. */
  SPEECH_TTS_VOICE: z.string().default("alloy"),
  /**
   * The `minimax` flavor's voice per side, which it can have because its
   * voices are cross-lingual: `language_boost` says which language the words
   * are in and the voice reads them in its own accent. So the group's own side
   * is read by an Indian woman rather than an American one, and the local side
   * by a Thai man — deliberately not the same person twice, because the whole
   * point of the page is that two people are talking.
   */
  SPEECH_VOICE_US: z.string().default("hindi_female_1_v2"),
  SPEECH_VOICE_THEM: z.string().default("Thai_male_1_sample8"),
  /**
   * How the local side is delivered. Semitones down and a little under speed:
   * lower and slower than the voice's own register, which is what carries
   * across a market stall. MiniMax takes pitch in semitones, -12 to 12.
   */
  SPEECH_VOICE_THEM_PITCH: z.coerce.number().min(-12).max(12).default(-5),
  SPEECH_VOICE_THEM_SPEED: z.coerce.number().min(0.5).max(2).default(0.9),
  /**
   * Which shape the voice endpoint speaks. "openai" is `/audio/speech`
   * returning audio bytes; "minimax" is `/v1/t2a_v2` returning hex audio in
   * JSON — worth its own branch because the same key already drives
   * LLM_BASE_URL, so the group pays one vendor rather than two.
   */
  SPEECH_FLAVOR: z.enum(["openai", "minimax"]).default("openai"),
  /** MiniMax only, and only where the account still requires it on the query. */
  SPEECH_GROUP_ID: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export type Env = typeof env;
