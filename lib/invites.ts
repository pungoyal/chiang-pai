// Invite links: how someone joins the table without an email address.
//
// The old allowlist worked by naming an address and waiting for Google to
// assert it. With no provider to assert anything, the invite itself has to be
// the credential — so it is a random code, and whoever holds it can join once.
//
// The code is stored alongside its hash, which the hash alone would not allow:
// a founder has to be able to re-share a link they already sent, and a group
// link is worth nothing if it cannot be pasted twice. So an invite is a
// readable capability, kept survivable by being short-lived and revocable
// rather than by being unreadable.

import { createHash, randomBytes } from "node:crypto";

/** 128 bits: not guessable, and still short enough to read out over a call. */
const CODE_BYTES = 16;

/** Long enough to get round to sending it, short enough that stale links die. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** A group link is meant to sit in a chat for a while, so it lives longer. */
export const GROUP_INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type InviteState = "live" | "used" | "expired";

/** A fresh code. Stored as-is beside its hash so the link can be re-shared. */
export function newInviteCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

/** What goes in the table. Plain SHA-256: the code is already full-entropy. */
export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code.trim(), "utf8").digest("hex");
}

/**
 * Used beats expired: a link somebody joined through is spent, whatever the
 * clock says, and which of the two it was is what the inviter wants to know.
 * An open link is never spent — that is the whole point of it.
 */
export function inviteState(
  invite: { expiresAt: Date; useCount: number; isOpen: boolean },
  now: Date,
): InviteState {
  if (!invite.isOpen && invite.useCount > 0) return "used";
  return invite.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export function expiresAtFrom(now: Date, isOpen = false): Date {
  return new Date(now.getTime() + (isOpen ? GROUP_INVITE_TTL_MS : INVITE_TTL_MS));
}

/** The link an inviter copies. `baseUrl` is AUTH_URL, already trailing-slash free. */
export function inviteUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/join/${code}`;
}
