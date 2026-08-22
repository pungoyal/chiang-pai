// Sign-in and cookie sessions, implemented directly on node:crypto — no auth
// library. Two ways in: passkeys (challenges minted at the bottom of this
// file, verified by lib/webauthn.ts) and Google, which passkeys are on their
// way to replacing.
//
// Flow: OAuth 2.0 authorization code + PKCE (S256), with `state` for CSRF and
// `nonce` bound into the ID token. The code is exchanged server-to-server over
// TLS with Google's token endpoint, so per OIDC Core §3.1.3.7 the TLS server
// identity stands in for verifying the ID token's signature — which is what
// lets this drop the JWKS/RS256 machinery. Every claim that actually gates
// access is still checked in verifyIdToken().
//
// Sessions are a compact HMAC-SHA256-signed token in an httpOnly cookie:
// `base64url(json).base64url(hmac)`. Nothing secret lives inside it — only a
// member id and an expiry — so signing is enough; encryption would add
// nothing here.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env.ts";
import { logger } from "./logger.ts";
import { relyingPartyFrom } from "./webauthn.ts";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Must match the authorised redirect URI registered in the Google console. */
const CALLBACK_PATH = "/api/auth/callback/google";

const SESSION_COOKIE = "chiang_pai_session";
const HANDSHAKE_COOKIE = "chiang_pai_oauth";
const SESSION_MAX_AGE_S = 60 * 60 * 24 * 30; // 30 days
const HANDSHAKE_MAX_AGE_S = 60 * 10; // long enough to pick an account, no longer

/** True once the deployment itself is on TLS; false for http://localhost dev. */
const secureCookies = env.AUTH_URL.startsWith("https://");

const cookieDefaults = {
  httpOnly: true,
  secure: secureCookies,
  // "lax", not "strict": the browser arrives back from Google via a top-level
  // GET redirect, and "strict" would withhold the cookie and break every
  // callback.
  sameSite: "lax",
  path: "/",
} as const;

export const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

// --- signed-cookie primitives -------------------------------------------------

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function hmac(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Tamper-evident (not secret) cookie value carrying its own expiry. */
function seal(claims: Record<string, unknown>, maxAgeSeconds: number): string {
  const body = Buffer.from(
    JSON.stringify({ ...claims, exp: nowSeconds() + maxAgeSeconds }),
  ).toString("base64url");
  return `${body}.${hmac(body)}`;
}

function unseal(token: string | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const split = token.lastIndexOf(".");
  if (split < 1) return null;
  const body = token.slice(0, split);
  if (!constantTimeEqual(token.slice(split + 1), hmac(body))) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof claims !== "object" || claims === null) return null;
    const { exp } = claims as { exp?: unknown };
    if (typeof exp !== "number" || exp <= nowSeconds()) return null;
    return claims as Record<string, unknown>;
  } catch {
    return null;
  }
}

// --- sessions -----------------------------------------------------------------

export type Session = { memberId: string };

/** The signed-in member id, or null. Safe to call anywhere a request exists. */
export async function getSession(): Promise<Session | null> {
  const claims = unseal((await cookies()).get(SESSION_COOKIE)?.value);
  const memberId = claims?.memberId;
  return typeof memberId === "string" ? { memberId } : null;
}

/** Only callable from a server action or route handler (it writes a cookie). */
export async function createSession(memberId: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, seal({ memberId }, SESSION_MAX_AGE_S), {
    ...cookieDefaults,
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function destroySession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

// --- consent --------------------------------------------------------------------
//
// Google sign-in creates the member in the callback, where no form is. The
// "I'm 18+ and agree" tick from the sign-in page rides over in a short signed
// cookie, so the member row carries the moment they agreed.

const CONSENT_COOKIE = "chiang_pai_consent";

export async function noteSignInIntent(intent: { agreed: boolean; next: string }): Promise<void> {
  (await cookies()).set(
    CONSENT_COOKIE,
    seal({ agreed: intent.agreed, next: safeNext(intent.next) }, HANDSHAKE_MAX_AGE_S),
    { ...cookieDefaults, maxAge: HANDSHAKE_MAX_AGE_S },
  );
}

/** Whether the sign-in that just completed was started with the box ticked, and where to go. */
export async function takeSignInIntent(): Promise<{ agreed: boolean; next: string }> {
  const jar = await cookies();
  const claims = unseal(jar.get(CONSENT_COOKIE)?.value);
  jar.delete(CONSENT_COOKIE);
  return {
    agreed: claims?.agreed === true,
    next: safeNext(typeof claims?.next === "string" ? claims.next : "/"),
  };
}

/** A path on this site, or home: never an open redirect. */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

// --- Google OAuth -------------------------------------------------------------

export type GoogleProfile = { email: string; name: string | null };

function redirectUri(): string {
  return `${env.AUTH_URL}${CALLBACK_PATH}`;
}

/**
 * Begin the authorization-code flow: mint state/nonce/PKCE verifier, stash
 * them in a short-lived signed cookie, and return the Google URL to send the
 * browser to.
 */
export async function startGoogleSignIn(): Promise<string> {
  if (!env.AUTH_GOOGLE_ID) throw new Error("Google sign-in is not configured");

  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");

  (await cookies()).set(HANDSHAKE_COOKIE, seal({ state, nonce, verifier }, HANDSHAKE_MAX_AGE_S), {
    ...cookieDefaults,
    maxAge: HANDSHAKE_MAX_AGE_S,
  });

  const url = new URL(AUTHORIZE_ENDPOINT);
  url.searchParams.set("client_id", env.AUTH_GOOGLE_ID);
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/**
 * Complete the flow. Returns the verified Google profile, or null if any part
 * of the callback fails to check out — the caller sends the member back to
 * /signin rather than reporting which step failed.
 */
export async function completeGoogleSignIn(params: URLSearchParams): Promise<GoogleProfile | null> {
  const jar = await cookies();
  const handshake = unseal(jar.get(HANDSHAKE_COOKIE)?.value);
  jar.delete(HANDSHAKE_COOKIE); // single use, whatever happens below

  const clientId = env.AUTH_GOOGLE_ID;
  const clientSecret = env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) return null;

  if (params.get("error")) {
    logger.info({ error: params.get("error") }, "google sign-in cancelled");
    return null;
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!handshake || !code || !state) {
    logger.warn("oauth callback: missing code, state, or handshake cookie");
    return null;
  }
  if (typeof handshake.state !== "string" || !constantTimeEqual(state, handshake.state)) {
    logger.warn("oauth callback: state mismatch");
    return null;
  }

  let tokens: { id_token?: unknown };
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(),
        code_verifier: String(handshake.verifier ?? ""),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "oauth token exchange failed");
      return null;
    }
    tokens = await res.json();
  } catch (err) {
    logger.warn({ err }, "oauth token exchange errored");
    return null;
  }

  if (typeof tokens.id_token !== "string") {
    logger.warn("oauth token exchange returned no id_token");
    return null;
  }
  return verifyIdToken(tokens.id_token, String(handshake.nonce ?? ""));
}

/**
 * Read and check the ID token's claims. The signature is deliberately not
 * verified — see the file header: the token arrived on our own authenticated
 * TLS connection to Google's token endpoint, so there is no untrusted hop for
 * a signature to protect against.
 */
function verifyIdToken(idToken: string, nonce: string): GoogleProfile | null {
  const payload = idToken.split(".")[1];
  if (!payload) return null;

  let claims: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    claims = parsed as Record<string, unknown>;
  } catch {
    logger.warn("id token payload was not valid JSON");
    return null;
  }

  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return null;
  if (claims.aud !== env.AUTH_GOOGLE_ID) return null;
  if (typeof claims.exp !== "number" || claims.exp <= nowSeconds()) return null;
  if (typeof claims.nonce !== "string" || !constantTimeEqual(claims.nonce, nonce)) {
    logger.warn("id token nonce mismatch");
    return null;
  }
  // Without this, anyone able to create an unverified Google account on an
  // invited member's address would pass the invite allowlist.
  if (claims.email_verified !== true) {
    logger.warn("id token email is not verified");
    return null;
  }
  if (typeof claims.email !== "string" || !claims.email) return null;

  return {
    email: claims.email,
    name: typeof claims.name === "string" ? claims.name : null,
  };
}

// --- passkeys -----------------------------------------------------------------
//
// The verification itself is in lib/webauthn.ts, which is pure. What lives here
// is the part that needs a request: minting the challenge and remembering it
// between the two round trips. It rides in the same kind of short-lived signed
// cookie as the OAuth handshake — a challenge is not a secret, it just has to
// come back unaltered and be usable exactly once.

// Which relying party this deployment is, and whether it can do passkeys at
// all. The rule is pure URL logic and lives in lib/webauthn.ts with its tests;
// what belongs here is reading env and saying so at startup.
const rp = relyingPartyFrom(env.AUTH_URL);

export const RP_ID = rp.rpId;
export const RP_ORIGIN = rp.origin;
export const passkeysConfigured = rp.usable;

if (!passkeysConfigured) {
  logger.warn(
    { authUrl: env.AUTH_URL, rpId: RP_ID, reason: rp.reason },
    "passkeys are unavailable for this deployment",
  );
}

const PASSKEY_COOKIE = "chiang_pai_passkey";
const PASSKEY_MAX_AGE_S = 60 * 5; // long enough for a fingerprint prompt

/**
 * Which ceremony a challenge was minted for; they never cross. Keeping these
 * apart is what stops a passkey made for a fresh invite from being attached to
 * someone's existing account, and — the one that would actually cost
 * something — stops a "recover" ceremony from being finished as a "join", or a
 * plain "register" from being finished as a recovery of somebody else's seat.
 * A "signup" is a join with no link: an account from nothing, for whoever is
 * about to open the first trip.
 */
export type PasskeyPurpose = "register" | "login" | "join" | "recover" | "signup";

/**
 * What a link-borne ceremony remembers between its two steps: the member it is
 * for — about to be created for a join, already at the table for a recovery —
 * and the code that authorised it. Both are re-checked against the database
 * before anything is written, so this is binding, not trust.
 */
export interface LinkClaims {
  memberId: string;
  code: string;
}

export interface PasskeyChallenge {
  challenge: string;
  link?: LinkClaims;
}

export async function startPasskeyChallenge(
  purpose: PasskeyPurpose,
  link?: LinkClaims,
): Promise<string> {
  const challenge = randomBytes(32).toString("base64url");
  (await cookies()).set(PASSKEY_COOKIE, seal({ ...link, challenge, purpose }, PASSKEY_MAX_AGE_S), {
    ...cookieDefaults,
    maxAge: PASSKEY_MAX_AGE_S,
  });
  return challenge;
}

/** Read the pending challenge and burn it, whatever the caller then makes of it. */
export async function takePasskeyChallenge(
  purpose: PasskeyPurpose,
): Promise<PasskeyChallenge | null> {
  const jar = await cookies();
  const claims = unseal(jar.get(PASSKEY_COOKIE)?.value);
  jar.delete(PASSKEY_COOKIE);
  if (!claims || claims.purpose !== purpose) return null;
  if (typeof claims.challenge !== "string") return null;
  const { memberId, code } = claims;
  return {
    challenge: claims.challenge,
    link: typeof memberId === "string" && typeof code === "string" ? { memberId, code } : undefined,
  };
}
