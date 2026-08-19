// Invite links: how someone joins the table without an email address.
//
// The old allowlist worked by naming an address and waiting for Google to
// assert it. With no provider to assert anything, the invite itself has to be
// the credential — so it is a random code, and whoever holds it can join once.
//
// Only the hash is stored. An invite is a bearer token, exactly like a session
// cookie, and a leaked database should not hand anyone a working one.

import { createHash, randomBytes } from "node:crypto";

/** 128 bits: not guessable, and still short enough to read out over a call. */
const CODE_BYTES = 16;

/** Long enough to get round to sending it, short enough that stale links die. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteState = "live" | "used" | "expired";

/** A fresh code. Shown to the inviter once and never recoverable afterwards. */
export function newInviteCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

/** What goes in the table. Plain SHA-256: the code is already full-entropy. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/** Used beats expired: a link that was accepted is spent, whatever the clock says. */
export function inviteState(
  invite: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): InviteState {
  if (invite.usedAt) return "used";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export function expiresAtFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

/** The link an inviter copies. `baseUrl` is AUTH_URL, already trailing-slash free. */
export function inviteUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/join/${code}`;
}
