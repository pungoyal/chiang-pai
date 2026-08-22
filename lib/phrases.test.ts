import { describe, expect, it } from "vitest";
import { MAX_SLUG, type SavedPhrase, slugify, uniqueSlug, voiceFor } from "./phrases.ts";
import { resolvePair } from "./talk.ts";

const THAI = resolvePair("en", "TH");

const phrase = (over: Partial<SavedPhrase> = {}): SavedPhrase => ({
  id: "p1",
  slug: "no-peanuts",
  side: "us",
  heard: "No peanuts, I'm allergic",
  said: "ไม่ใส่ถั่วนะครับ แพ้ถั่ว",
  roman: "mâi sài tùa ná khráp, pháe tùa",
  language: "Thai",
  tag: "th-TH",
  keptBy: "m1",
  ...over,
});

describe("slugs", () => {
  it("makes a handle out of what somebody typed", () => {
    expect(slugify("No peanuts")).toBe("no-peanuts");
    expect(slugify("  Where's the toilet?  ")).toBe("where-s-the-toilet");
    expect(slugify("Taxi — 200 baht!")).toBe("taxi-200-baht");
  });

  it("folds Latin accents and leaves other scripts alone", () => {
    expect(slugify("Café")).toBe("cafe");
    expect(slugify("ไม่เผ็ด")).toBe("ไม่เผ็ด");
    expect(slugify("थोड़ा")).toBe("थोड़ा");
  });

  it("has nothing to make a handle out of, and says so by being empty", () => {
    expect(slugify("   ")).toBe("");
    expect(slugify("!!! ???")).toBe("");
  });

  it("never ends on a dash, even after the length cut", () => {
    const slug = slugify(`${"a".repeat(MAX_SLUG - 1)} bbbb`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("unique slugs", () => {
  it("leaves a free name alone", () => {
    expect(uniqueSlug("No peanuts", ["taxi", "hello"])).toBe("no-peanuts");
  });

  it("numbers a repeat rather than refusing or overwriting it", () => {
    expect(uniqueSlug("Taxi", ["taxi"])).toBe("taxi-2");
    expect(uniqueSlug("Taxi", ["taxi", "taxi-2", "taxi-3"])).toBe("taxi-4");
  });

  it("only collides with this member's own slugs", () => {
    expect(uniqueSlug("Taxi", [])).toBe("taxi");
  });

  it("is empty when the name was only punctuation", () => {
    expect(uniqueSlug("???", [])).toBe("");
  });
});

describe("saying a saved phrase again", () => {
  it("speaks it as the side whose language it is in", () => {
    expect(voiceFor(phrase(), THAI)).toEqual({ tag: "th-TH", prefer: "male", side: "them" });
  });

  it("speaks a kept reply back in the group's own language", () => {
    expect(voiceFor(phrase({ side: "them", tag: "en-IN" }), THAI)).toEqual({
      tag: "en-IN",
      prefer: "female",
      side: "us",
    });
  });

  it("takes the tag the pair spells it with, however the phrase spells it", () => {
    expect(voiceFor(phrase({ tag: "th" }), THAI).tag).toBe("th-TH");
    expect(voiceFor(phrase({ tag: "th_TH" }), THAI).side).toBe("them");
  });

  it("refuses the server a side once the deploy has moved on", () => {
    // Saved in Thailand, replayed after the group flew home: the device may
    // still have a Thai voice, but the voice service would read it as whatever
    // this deploy now calls "them".
    const india = resolvePair("en", "IN");
    expect(voiceFor(phrase(), india)).toEqual({ tag: "th-TH", side: null });
  });
});
