import { describe, expect, it } from "vitest";
import {
  expiresAtFrom,
  GROUP_INVITE_TTL_MS,
  hashInviteCode,
  INVITE_TTL_MS,
  inviteState,
  inviteUrl,
  newInviteCode,
  partitionInvites,
} from "./invites.ts";

const NOW = new Date("2026-08-19T12:00:00Z");

describe("newInviteCode", () => {
  it("is URL-safe, so it can be the last segment of a link", () => {
    expect(newInviteCode()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries 128 bits — long enough that guessing is not a threat model", () => {
    expect(newInviteCode()).toHaveLength(22); // 16 bytes, base64url, unpadded
  });

  it("never repeats", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newInviteCode()));
    expect(codes.size).toBe(200);
  });
});

describe("hashInviteCode", () => {
  it("is stable, so a link can be looked up by what it hashes to", () => {
    const code = newInviteCode();
    expect(hashInviteCode(code)).toBe(hashInviteCode(code));
  });

  it("separates two codes", () => {
    expect(hashInviteCode("aaa")).not.toBe(hashInviteCode("aab"));
  });

  it("is a sha256 digest in hex", () => {
    expect(hashInviteCode("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("forgives the whitespace that survives a copy-paste", () => {
    expect(hashInviteCode("  code  ")).toBe(hashInviteCode("code"));
  });

  it("keeps case: the code is case-sensitive base64url, not a word", () => {
    expect(hashInviteCode("Code")).not.toBe(hashInviteCode("code"));
  });
});

describe("inviteState", () => {
  const live = { expiresAt: new Date("2026-08-26T12:00:00Z"), useCount: 0, isOpen: false };

  it("is live until it expires", () => {
    expect(inviteState(live, NOW)).toBe("live");
  });

  it("expires on the stroke, not after it", () => {
    expect(inviteState({ ...live, expiresAt: NOW }, NOW)).toBe("expired");
    expect(inviteState({ ...live, expiresAt: new Date(NOW.getTime() + 1) }, NOW)).toBe("live");
  });

  it("counts as used once someone has joined with it", () => {
    expect(inviteState({ ...live, useCount: 1 }, NOW)).toBe("used");
  });

  it("reports a spent link as used even after it would have expired", () => {
    // Which it was matters to the inviter: "used" means someone is at the
    // table, "expired" means nobody ever came.
    const spent = { expiresAt: new Date("2026-01-01T00:00:00Z"), useCount: 1, isOpen: false };
    expect(inviteState(spent, NOW)).toBe("used");
  });

  it("never spends a group link, however many people walk through it", () => {
    const group = { ...live, isOpen: true, useCount: 12 };
    expect(inviteState(group, NOW)).toBe("live");
  });

  it("still expires a group link — an open door needs a closing time", () => {
    expect(inviteState({ ...live, isOpen: true, useCount: 12, expiresAt: NOW }, NOW)).toBe(
      "expired",
    );
  });
});

describe("expiresAtFrom", () => {
  it("gives a personal invite a week", () => {
    expect(expiresAtFrom(NOW).getTime() - NOW.getTime()).toBe(INVITE_TTL_MS);
  });

  it("gives a group link a month, since it sits in a chat", () => {
    expect(expiresAtFrom(NOW, true).getTime() - NOW.getTime()).toBe(GROUP_INVITE_TTL_MS);
  });
});

describe("inviteUrl", () => {
  it("puts the code in the path, where it is never sent to an analytics query string", () => {
    expect(inviteUrl("https://pai.example.com", "abc123")).toBe(
      "https://pai.example.com/join/abc123",
    );
  });
});

describe("partitionInvites", () => {
  const row = (
    over: Partial<{ id: string; expiresAt: Date; useCount: number; isOpen: boolean }>,
  ) => ({
    id: "x",
    expiresAt: new Date("2026-08-26T12:00:00Z"),
    useCount: 0,
    isOpen: false,
    ...over,
  });

  it("keeps the group link apart from the personal invites", () => {
    const { groupLink, personal } = partitionInvites(
      [row({ id: "a" }), row({ id: "open", isOpen: true }), row({ id: "b" })],
      NOW,
    );
    expect(groupLink?.id).toBe("open");
    expect(personal.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("drops spent and expired rows from both", () => {
    const { groupLink, personal } = partitionInvites(
      [
        row({ id: "spent", useCount: 1 }),
        row({ id: "stale", expiresAt: new Date("2026-01-01T00:00:00Z") }),
        row({ id: "shut", isOpen: true, expiresAt: new Date("2026-01-01T00:00:00Z") }),
      ],
      NOW,
    );
    expect(groupLink).toBeNull();
    expect(personal).toEqual([]);
  });

  it("keeps a group link however many people have walked through it", () => {
    const { groupLink } = partitionInvites([row({ isOpen: true, useCount: 9 })], NOW);
    expect(groupLink?.useCount).toBe(9);
  });

  it("has no group link when nobody minted one", () => {
    expect(partitionInvites([row({})], NOW).groupLink).toBeNull();
  });
});
