import { describe, expect, it } from "vitest";
import {
  newRecoveryCode,
  RECOVERY_NOTICE_MS,
  RECOVERY_TTL_MS,
  recoveryExpiresAt,
  recoveryState,
  recoveryUrl,
  visibleRecoveries,
} from "./recovery.ts";

const NOW = new Date("2026-08-19T12:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("newRecoveryCode", () => {
  it("is URL-safe and 128 bits, exactly like an invite code", () => {
    expect(newRecoveryCode()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("never repeats", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRecoveryCode()));
    expect(codes.size).toBe(200);
  });
});

describe("recoveryState", () => {
  const live = { expiresAt: minutes(30), usedAt: null as Date | null };

  it("is live until it expires", () => {
    expect(recoveryState(live, NOW)).toBe("live");
  });

  it("expires on the stroke, not after it", () => {
    expect(recoveryState({ ...live, expiresAt: NOW }, NOW)).toBe("expired");
    expect(recoveryState({ ...live, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe("live");
  });

  it("is used the moment someone walks through it, and stays that way", () => {
    // A recovery link is spent by one passkey and one only: a second holder of
    // the same URL must not be able to add another key to the same seat.
    expect(recoveryState({ expiresAt: minutes(30), usedAt: minutes(1) }, NOW)).toBe("used");
  });

  it("reports a spent link as used long after it would have expired", () => {
    const spent = { expiresAt: new Date("2026-01-01T00:00:00Z"), usedAt: minutes(-60) };
    expect(recoveryState(spent, NOW)).toBe("used");
  });
});

describe("recoveryExpiresAt", () => {
  it("gives half an hour — the window a founder is on the phone for", () => {
    expect(recoveryExpiresAt(NOW).getTime() - NOW.getTime()).toBe(RECOVERY_TTL_MS);
  });

  it("is far shorter than any invite: this link is a seat, not a chair", () => {
    expect(RECOVERY_TTL_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

describe("recoveryUrl", () => {
  it("puts the code in the path, and nowhere near /join", () => {
    expect(recoveryUrl("https://pai.example.com", "abc123")).toBe(
      "https://pai.example.com/recover/abc123",
    );
  });
});

describe("visibleRecoveries", () => {
  const row = (over: Partial<{ id: string; expiresAt: Date; usedAt: Date | null }>) => ({
    id: "x",
    expiresAt: minutes(30),
    usedAt: null as Date | null,
    ...over,
  });

  it("names every link still open, so nobody's seat is fetched for quietly", () => {
    const { live } = visibleRecoveries([row({ id: "a" }), row({ id: "b" })], NOW);
    expect(live.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("keeps reporting a used link for a week — the record of what happened", () => {
    const { live, used } = visibleRecoveries([row({ id: "spent", usedAt: minutes(-5) })], NOW);
    expect(live).toEqual([]);
    expect(used.map((r) => r.id)).toEqual(["spent"]);
  });

  it("lets the notice lapse once the week is up", () => {
    const old = row({ id: "old", usedAt: new Date(NOW.getTime() - RECOVERY_NOTICE_MS - 1) });
    expect(visibleRecoveries([old], NOW).used).toEqual([]);
  });

  it("says nothing about a link that expired unused — nobody came", () => {
    const stale = row({ id: "stale", expiresAt: minutes(-1) });
    expect(visibleRecoveries([stale], NOW)).toEqual({ live: [], used: [] });
  });
});
