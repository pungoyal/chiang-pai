// Every flavored UI string lives in lingo.yaml at the repo root — edit that,
// not this file. `pnpm lingo:gen` (which `pnpm dev` and `pnpm build` run for
// you) compiles it into lingo.data.ts; this module gives that data its types
// and turns the placeholder templates into functions.
//
// Each member picks the lingo the app speaks to them in (members.lingo);
// "english" is the default and the plain-vocabulary baseline. The dialects are
// written as friend-group roast: they tease the reader freely. Buttons, nav,
// and rule errors stay plain everywhere — personality lives in headings, empty
// states, asides, result lines, and placeholders.
// Pure data: safe to import from both server and client components.

import { LINGO_KEYS, RAW_LINGOS } from "./lingo.data.ts";

export { LINGO_KEYS };

export type LingoKey = (typeof LINGO_KEYS)[number];

export interface Lingo {
  /** Display name in the picker. */
  name: string;
  /** Register description handed to the AI polish prompt. */
  register: string;
  footer: string;
  activityHeading: string;
  activitySoFarHeading: string;
  activityEmpty: string;
  joinedFeed: string;
  joinedLedger: string;
  openEmptyTitle: string;
  openEmptySub: string;
  resolvedEmpty: string;
  forYouHeading: string;
  forYouSub: string;
  openBetsEmpty: string;
  betsEmpty: string;
  poolEmpty: string;
  leaderboardTitle: string;
  leaderboardSub: (min: number) => string;
  leaderboardEmptyTitle: string;
  calibratingSub: string;
  membersTitle: string;
  membersSub: string;
  newTitle: string;
  magicPitch: string;
  inboxSub: string;
  inboxEmptyTitle: string;
  inboxEmptySub: string;
  stakeLimit: string;
  voidHint: string;
  resolveSub: string;
  recording: string;
  oops: string;
  youWon: (amount: string) => string;
  youLost: (amount: string) => string;
  brokeEven: string;
  questionPlaceholder: string;
  criteriaPlaceholder: string;
  commentsHeading: string;
  commentsEmpty: string;
  commentPlaceholder: string;
  billsTitle: string;
  billsSub: string;
  billsEmptyTitle: string;
  billsEmptySub: string;
  allSquare: string;
  talkTitle: (language: string) => string;
  talkSub: (language: string) => string;
  phrasebookHeading: string;
  startersHeading: string;
  startersSub: string;
  tripsTitle: string;
  tripsSub: string;
  tripsEmptyTitle: string;
  tripsEmptySub: string;
  newTripTitle: string;
  newTripSub: string;
  recapTitle: string;
  recapSub: string;
  recapEmptyTitle: string;
  recapEmptySub: string;
}

/**
 * One lingo exactly as YAML holds it: every field a string, including the ones
 * that carry {placeholders}. The generated data is checked against this, so a
 * field renamed in lingo.yaml fails to compile instead of rendering blank.
 */
export type RawLingo = { [K in keyof Lingo]: string };

/** Substitute {named} placeholders; anything unknown is left visible. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    name in vars ? String(vars[name]) : whole,
  );
}

function hydrate(raw: RawLingo): Lingo {
  return {
    ...raw,
    leaderboardSub: (min) => fill(raw.leaderboardSub, { min }),
    youWon: (amount) => fill(raw.youWon, { amount }),
    talkTitle: (language) => fill(raw.talkTitle, { language }),
    talkSub: (language) => fill(raw.talkSub, { language }),
    youLost: (amount) => fill(raw.youLost, { amount }),
  };
}

export const LINGOS = Object.fromEntries(
  LINGO_KEYS.map((key) => [key, hydrate(RAW_LINGOS[key])]),
) as Record<LingoKey, Lingo>;

export function isLingoKey(key: string): key is LingoKey {
  return (LINGO_KEYS as readonly string[]).includes(key);
}

/** The member's lingo, falling back to plain English for anything unknown. */
export function lingoOf(key: string): Lingo {
  return isLingoKey(key) ? LINGOS[key] : LINGOS.english;
}
