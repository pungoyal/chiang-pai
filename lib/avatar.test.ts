import { describe, expect, it } from "vitest";
import { AVATAR_TINTS, avatarSrc, avatarTint, initials, sniffImageType } from "./avatar.ts";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Uint8Array.from([...toBytes("RIFF"), 0x24, 0x00, 0x00, 0x00, ...toBytes("WEBP")]);

function toBytes(text: string): number[] {
  return [...text].map((ch) => ch.charCodeAt(0));
}

describe("sniffImageType", () => {
  it("recognizes jpeg, png, and webp by their magic bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  it("rejects anything else — the claimed MIME type is never consulted", () => {
    expect(sniffImageType(Uint8Array.from(toBytes("GIF89a")))).toBeNull();
    expect(sniffImageType(Uint8Array.from(toBytes("<svg xmlns=")))).toBeNull();
    expect(sniffImageType(Uint8Array.from([]))).toBeNull();
  });

  it("rejects truncated headers rather than reading past the end", () => {
    expect(sniffImageType(JPEG.slice(0, 2))).toBeNull();
    expect(sniffImageType(PNG.slice(0, 4))).toBeNull();
    expect(sniffImageType(WEBP.slice(0, 10))).toBeNull();
  });

  it("requires WEBP after RIFF — other RIFF containers are not images", () => {
    expect(
      sniffImageType(Uint8Array.from([...toBytes("RIFF"), 0, 0, 0, 0, ...toBytes("WAVE")])),
    ).toBeNull();
  });
});

describe("avatarSrc", () => {
  const base = { id: "m1", avatarUpdatedAt: null };

  it("has no picture until one is uploaded — the monogram takes it from there", () => {
    expect(avatarSrc(base)).toBeNull();
  });

  it("serves the uploaded avatar and stamps it for cache-busting", () => {
    const at = new Date("2026-08-19T10:00:00Z");
    expect(avatarSrc({ ...base, avatarUpdatedAt: at })).toBe(`/api/avatar/m1?v=${at.getTime()}`);
  });

  it("changes the URL on re-upload so browsers refetch", () => {
    const first = avatarSrc({ ...base, avatarUpdatedAt: new Date(1_000) });
    const second = avatarSrc({ ...base, avatarUpdatedAt: new Date(2_000) });
    expect(first).not.toBe(second);
  });
});

describe("initials", () => {
  it("takes the first and last name, so middle names don't crowd it out", () => {
    expect(initials("Puneet Goyal")).toBe("PG");
    expect(initials("Anna Maria Vasquez")).toBe("AV");
  });

  it("takes two letters from a single name", () => {
    expect(initials("Priya")).toBe("PR");
    expect(initials("V")).toBe("V");
  });

  it("ignores the spacing and punctuation people type around their names", () => {
    expect(initials("  divya   krishnan  ")).toBe("DK");
    expect(initials("(kiran)")).toBe("KI");
    expect(initials("Jean-Luc Picard")).toBe("JP");
  });

  it("counts characters, not code units, so scripts outside ASCII still work", () => {
    expect(initials("अर्जुन शर्मा")).toBe("अश");
    expect(initials("🎲 roller")).toBe("RO");
  });

  it("always renders something", () => {
    expect(initials("")).toBe("?");
    expect(initials("   ")).toBe("?");
    expect(initials("!!!")).toBe("?");
  });
});

describe("avatarTint", () => {
  it("gives every member one of the palette's gradients", () => {
    expect(AVATAR_TINTS).toContainEqual(avatarTint("some-uuid"));
  });

  it("is stable for a member — the same id always looks the same", () => {
    expect(avatarTint("m1")).toEqual(avatarTint("m1"));
  });

  it("separates members who share initials — the seed is the id, not the name", () => {
    expect(avatarTint("m1")).not.toEqual(avatarTint("m3"));
  });

  it("spreads a realistic group of ids across the palette", () => {
    const ids = Array.from({ length: 60 }, (_, i) => `member-${i}`);
    const used = new Set(ids.map((id) => avatarTint(id).join()));
    expect(used.size).toBeGreaterThan(AVATAR_TINTS.length / 2);
  });
});
