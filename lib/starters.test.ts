import { describe, expect, it } from "vitest";
import { type StarterContext, starters } from "./starters.ts";

const base: StarterContext = {
  name: "Chiang Mai",
  place: "Thailand",
  destination: "TH",
  homeCurrency: "inr",
  foreignCurrency: "thb",
  startsOn: "2026-11-06",
  endsOn: "2026-11-10",
  members: [
    { id: "me", name: "Puneet" },
    { id: "r", name: "Rohan" },
    { id: "s", name: "Sneha" },
  ],
  viewerId: "me",
  today: "2026-08-22",
};

describe("starters", () => {
  it("asks whether the trip happens while it is still ahead", () => {
    const keys = starters(base).map((s) => s.key);
    expect(keys).toEqual([
      "everyone-shows",
      "booked-in-time",
      "planner-plan",
      "late-to-airport",
      "first-to-sleep",
      "haggle",
      "lost-item",
      "square-in-a-week",
    ]);
    const booked = starters(base).find((s) => s.key === "booked-in-time")!;
    expect(booked.criteria).toContain("2026-10-30");
    const square = starters(base).find((s) => s.key === "square-in-a-week")!;
    expect(square.criteria).toContain("2026-11-17");
  });

  it("never makes the viewer the subject, and names the others in turn", () => {
    const all = starters(base);
    for (const s of all) expect(s.question).not.toContain("Puneet");
    expect(all.find((s) => s.key === "late-to-airport")?.question).toContain("Rohan");
    expect(all.find((s) => s.key === "first-to-sleep")?.question).toContain("Sneha");
  });

  it("drops the booking question inside the last week, and the haggle at home", () => {
    const soon = starters({ ...base, today: "2026-11-01" }).map((s) => s.key);
    expect(soon).not.toContain("booked-in-time");
    const goa = starters({ ...base, foreignCurrency: null, destination: "IN" }).map((s) => s.key);
    expect(goa).not.toContain("haggle");
  });

  it("leaves only the bills question once the trip is over", () => {
    expect(starters({ ...base, today: "2026-12-01" }).map((s) => s.key)).toEqual([
      "square-in-a-week",
    ]);
  });

  it("copes with a roster of one", () => {
    const alone = starters({ ...base, members: [{ id: "me", name: "Puneet" }] });
    expect(alone.map((s) => s.key)).toEqual([
      "everyone-shows",
      "booked-in-time",
      "haggle",
      "lost-item",
      "square-in-a-week",
    ]);
  });
});
