// The phrases somebody kept.
//
// A conversation on /talk still dies with the tab — that is the whole shape of
// the page. This is the one deliberate exception: a member points at a turn,
// gives it a name, and that single line outlives the tab. It is a phrasebook
// they wrote themselves, not a transcript: only what was pointed at, only
// under a name they chose, and gone the moment they delete it.
//
// The name is turned into a slug, which is what a member actually holds on to
// — short, typeable, and the same string every time, so "no-peanuts" means the
// one line at the top of the list rather than whichever of three near-identical
// ones was saved last. It is unique per member and per member only; two people
// keeping their own "taxi" is two phrases, not a collision.
//
// A saved phrase carries the language it is in, because the pair is deployment
// configuration and configuration moves. A Thai line replayed after the group
// flies to India must still be read by a Thai voice, or not read at all —
// never handed to whatever voice happens to be configured now.
//
// Pure data in, pure data out; lib/data.ts does the I/O.

import { type Pair, type Side, speakerOf, type VoicePreference } from "./talk.ts";

/** As typed by whoever saved it, before slugging. Longer than this is a note. */
export const MAX_PHRASE_NAME = 40;

/** A slug is a handle, not a sentence. */
export const MAX_SLUG = 40;

/**
 * How many a trip keeps. A phrasebook you can read down in a night market is
 * the point; past this it is a log, and the thing you wanted is buried.
 */
export const MAX_PHRASES = 60;

export interface SavedPhrase {
  id: string;
  /** The handle: unique among the trip's phrases, and what the list shows. */
  slug: string;
  /** Who said it. The phrase itself is in the *other* side's language. */
  side: Side;
  /** What was heard, in the language it was said in. */
  heard: string;
  /** What comes out of the phone. */
  said: string;
  roman?: string;
  literal?: string;
  /** What `said` is in, named as it was named on the day it was saved. */
  language: string;
  /** BCP-47 for `said`, for choosing a voice long after the trip. */
  tag: string;
  /** Who kept it — the one member who can drop it. */
  keptBy: string;
}

/**
 * A name reduced to a handle: lower case, letters and numbers, dashes for
 * everything between. Combining marks are letters here — a Thai tone mark or a
 * Hindi matra is part of the word, and dropping them leaves a slug that is not
 * the word any more. Latin accents still fold, because there the folded
 * spelling is the one somebody would type.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "");
}

/**
 * The slug this name gets, given the ones the member already holds. A repeat
 * is numbered rather than refused or overwritten: somebody saving "taxi" twice
 * wants both lines kept, and finding out which is which is a tap.
 *
 * Empty when the name had nothing in it to make a handle out of — the caller
 * turns that into the refusal, since it is the only one worth a message.
 */
export function uniqueSlug(name: string, taken: readonly string[]): string {
  const base = slugify(name);
  if (!base) return "";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

export interface PhraseVoice {
  /** The language to read it in, whatever this deploy is pointed at now. */
  tag: string;
  /** Which of the device's voices for it the group asked for, where it knows. */
  prefer?: VoicePreference;
  /**
   * Which side the server should speak as, or null when this phrase is not in
   * either of the pair's languages any more. The voice service is told a side
   * and looks the language up itself, so a phrase from a previous destination
   * has nothing true to tell it: the device's own voice or nothing.
   */
  side: Side | null;
}

/** Browsers spell a tag `th-TH`, `th_TH` or `th`; all three mean Thai. */
function sameTag(a: string, b: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace("_", "-").split("-")[0];
  return norm(a) === norm(b);
}

/** How to say a saved phrase out loud, on this device and on this deploy. */
export function voiceFor(phrase: { tag: string }, pair: Pair): PhraseVoice {
  for (const side of ["us", "them"] as const) {
    const speaker = speakerOf(pair, side);
    if (sameTag(speaker.tag, phrase.tag)) {
      return { tag: speaker.tag, prefer: speaker.voice, side };
    }
  }
  return { tag: phrase.tag, side: null };
}
