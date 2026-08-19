// Profile pictures: what counts as a valid upload, which picture a member
// shows, and the monogram everyone falls back to. Pure — the uploaded bytes
// themselves live in the `avatars` table and move through lib/data.ts.

/** Hard cap on stored avatar bytes; the client downscales well below this. */
export const MAX_AVATAR_BYTES = 512 * 1024;

export type AvatarImageType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Identify an image by its magic bytes — the client's claimed MIME type is
 * never trusted, since these bytes are served back to every member's browser.
 */
export function sniffImageType(bytes: Uint8Array): AvatarImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const ascii = (at: number, text: string) =>
    bytes.length >= at + text.length &&
    [...text].every((ch, i) => bytes[at + i] === ch.charCodeAt(0));
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, "PNG\r\n\x1a\n")) return "image/png";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/**
 * The picture a member shows, or null for the generated monogram below. Only
 * an upload counts: `members.image` holds a googleusercontent URL, which is a
 * third-party identifier we are in the business of shedding, so nothing reads
 * it any more. `avatarUpdatedAt` doubles as the cache-buster so a re-upload is
 * visible immediately.
 */
export function avatarSrc(member: { id: string; avatarUpdatedAt: Date | null }): string | null {
  if (!member.avatarUpdatedAt) return null;
  return `/api/avatar/${member.id}?v=${member.avatarUpdatedAt.getTime()}`;
}

// ---------- the generated fallback ----------

/**
 * Gradient pairs for generated avatars. Deep enough that white initials stay
 * legible on either theme, and distinct enough to tell six friends apart at
 * 26px in the header.
 */
export const AVATAR_TINTS: readonly (readonly [string, string])[] = [
  ["#1f4a38", "#2f6b4f"], // felt
  ["#2b3f8f", "#4257b2"], // indigo
  ["#a8431a", "#c8622a"], // rust
  ["#6d3573", "#8c4a93"], // plum
  ["#8a6414", "#ab7f22"], // gold
  ["#14595f", "#1f7a80"], // teal
  ["#8f2036", "#b32f48"], // crimson
  ["#34456b", "#4a5f8f"], // slate
  ["#4a5c1e", "#66792d"], // olive
  ["#8c3d10", "#a85a1c"], // amber
];

/**
 * Up to two letters standing in for a member: initials for a full name, the
 * first two letters for a single one. Falls back to "?" so a name of pure
 * punctuation still renders something.
 */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => [...word].filter((ch) => /[\p{L}\p{N}]/u.test(ch)))
    .filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  // First and last, not first and second: "Anna Maria Vasquez" is AV.
  const letters = words.length === 1 ? words[0].slice(0, 2) : [words[0][0], words.at(-1)![0]];
  return letters.join("").toUpperCase();
}

/**
 * The colour a generated avatar uses, keyed on the member id rather than the
 * name — an id never changes, so a member who renames keeps the face the group
 * already recognises, and two people with the same initials still differ.
 */
export function avatarTint(seed: string): readonly [string, string] {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) % 0x7fffffff;
  return AVATAR_TINTS[hash % AVATAR_TINTS.length];
}
