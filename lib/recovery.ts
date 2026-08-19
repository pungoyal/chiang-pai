// Recovery links: how a member gets back to their own seat after losing every
// passkey they held.
//
// A recovery link and an invite link are the same primitive — a random code in
// a URL — pointed at opposite ends of a member's life, and what they cost when
// one goes astray is why this is its own module and its own table. A stray
// invite makes a stranger a *new* member: no history, nothing staked, plain to
// see in the list. A stray recovery link makes them an *existing* one — that
// member's net, their bills, their word in the comments, and their vote on
// what a prediction resolved to.
//
// Nothing in code can make that safe, because minting one is a founder
// vouching for somebody out of band; the check that matters is a phone call.
// So everything here is about narrowing the window and removing the quiet:
// half an hour, one use, one live link per member at a time, revocable by the
// member it names as well as by any founder — and every one of them announced
// on the members page, before it is used and after.

import { newInviteCode } from "./invites.ts";

/** Long enough to talk someone through it on a call, short enough to be an event. */
export const RECOVERY_TTL_MS = 30 * 60 * 1000;

/** How long a spent link keeps being reported to the table after the fact. */
export const RECOVERY_NOTICE_MS = 7 * 24 * 60 * 60 * 1000;

/** The same 128-bit code an invite gets; the table it lands in is what makes it a recovery. */
export const newRecoveryCode = newInviteCode;

export type RecoveryState = "live" | "used" | "expired";

/** What the row is now. Used beats expired, as with invites: it happened. */
export function recoveryState(
  row: { expiresAt: Date; usedAt: Date | null },
  now: Date,
): RecoveryState {
  if (row.usedAt) return "used";
  return row.expiresAt.getTime() <= now.getTime() ? "expired" : "live";
}

export function recoveryExpiresAt(now: Date): Date {
  return new Date(now.getTime() + RECOVERY_TTL_MS);
}

/** The link a founder passes on. `baseUrl` is AUTH_URL, already trailing-slash free. */
export function recoveryUrl(baseUrl: string, code: string): string {
  return `${baseUrl}/recover/${code}`;
}

/**
 * What the members page tells the table: links that could still be walked
 * through, and ones somebody walked through recently. An expired unused row is
 * neither — nobody came, so there is nothing to report and no reason to keep
 * naming whoever it was minted for.
 */
export function visibleRecoveries<T extends { expiresAt: Date; usedAt: Date | null }>(
  rows: readonly T[],
  now: Date,
): { live: T[]; used: T[] } {
  const live: T[] = [];
  const used: T[] = [];
  for (const row of rows) {
    if (row.usedAt) {
      if (now.getTime() - row.usedAt.getTime() < RECOVERY_NOTICE_MS) used.push(row);
    } else if (recoveryState(row, now) === "live") {
      live.push(row);
    }
  }
  return { live, used };
}
