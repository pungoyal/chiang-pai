import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_STAKE_PIES,
  daysBetween,
  defaultCurrency,
  isDomestic,
  isoDay,
  placeOf,
  TripError,
  tripConfig,
  tripCurrencies,
  tripPhase,
} from "./trips.ts";

describe("tripConfig", () => {
  it("derives the foreign currency from the destination", () => {
    const t = tripConfig({ name: "  Chiang  Mai  ", destination: "th" });
    expect(t.name).toBe("Chiang Mai");
    expect(t.destination).toBe("TH");
    expect(t.homeLanguage).toBe("en");
    expect(t.homeCurrency).toBe("inr");
    expect(t.foreignCurrency).toBe("thb");
    expect(t.maxStakePies).toBe(DEFAULT_MAX_STAKE_PIES);
    expect(t.startsOn).toBeNull();
  });

  it("drops the foreign currency when it is the home one — a domestic trip", () => {
    const goa = tripConfig({ name: "Goa", destination: "IN" });
    expect(goa.foreignCurrency).toBeNull();
    expect(isDomestic(goa)).toBe(true);
    expect(tripCurrencies(goa)).toEqual(["inr"]);
    expect(defaultCurrency(goa)).toBe("inr");

    const london = tripConfig({ name: "London", destination: "GB", homeCurrency: "gbp" });
    expect(london.foreignCurrency).toBeNull();
  });

  it("puts the destination's money first on a foreign trip", () => {
    const t = tripConfig({ name: "Hanoi", destination: "VN" });
    expect(tripCurrencies(t)).toEqual(["vnd", "inr"]);
    expect(defaultCurrency(t)).toBe("vnd");
    expect(isDomestic(t)).toBe(false);
  });

  it("refuses what it cannot make a trip of", () => {
    expect(() => tripConfig({ name: "x", destination: "TH" })).toThrow(TripError);
    expect(() => tripConfig({ name: "a".repeat(61), destination: "TH" })).toThrow(/under/);
    expect(() => tripConfig({ name: "Mars", destination: "XX" })).toThrow(/destination/);
    expect(() => tripConfig({ name: "T", destination: "TH", homeLanguage: "xx" })).toThrow(
      /Give the trip a name/,
    );
    expect(() => tripConfig({ name: "Trip", destination: "TH", homeLanguage: "xx" })).toThrow(
      /home language/,
    );
    expect(() => tripConfig({ name: "Trip", destination: "TH", homeCurrency: "xyz" })).toThrow(
      /home currency/,
    );
    expect(() => tripConfig({ name: "Trip", destination: "TH", startsOn: "2026-13-40" })).toThrow(
      /start date/,
    );
    expect(() =>
      tripConfig({ name: "Trip", destination: "TH", startsOn: "2026-11-10", endsOn: "2026-11-01" }),
    ).toThrow(/end before/);
    expect(() => tripConfig({ name: "Trip", destination: "TH", maxStakePies: 0 })).toThrow(/cap/);
    expect(() => tripConfig({ name: "Trip", destination: "TH", maxStakePies: 2.5 })).toThrow(/cap/);
  });

  it("keeps dates as the calendar days they were typed", () => {
    const t = tripConfig({
      name: "Diwali",
      destination: "TH",
      startsOn: "2026-11-06",
      endsOn: "2026-11-10",
    });
    expect(t.startsOn).toBe("2026-11-06");
    expect(t.endsOn).toBe("2026-11-10");
    expect(daysBetween(t.startsOn!, t.endsOn!)).toBe(4);
  });
});

describe("tripPhase", () => {
  const t = { destination: "TH", homeCurrency: "inr", foreignCurrency: "thb" };
  it("is undated without dates and follows the calendar with them", () => {
    expect(tripPhase({ ...t, startsOn: null, endsOn: null }, "2026-08-22")).toBe("undated");
    const dated = { ...t, startsOn: "2026-11-06", endsOn: "2026-11-10" };
    expect(tripPhase(dated, "2026-08-22")).toBe("before");
    expect(tripPhase(dated, "2026-11-06")).toBe("during");
    expect(tripPhase(dated, "2026-11-10")).toBe("during");
    expect(tripPhase(dated, "2026-11-11")).toBe("after");
  });
  it("treats a missing end as open-ended, and a missing start as already begun", () => {
    expect(tripPhase({ ...t, startsOn: "2026-11-06", endsOn: null }, "2027-01-01")).toBe("during");
    expect(tripPhase({ ...t, startsOn: null, endsOn: "2026-11-10" }, "2026-01-01")).toBe("during");
  });
});

describe("helpers", () => {
  it("names the place and formats a day in a zone", () => {
    expect(placeOf({ destination: "TH" })).toBe("Thailand");
    expect(placeOf({ destination: "ZZ" })).toBe("ZZ");
    expect(isoDay(new Date("2026-11-06T20:30:00Z"), "Asia/Kolkata")).toBe("2026-11-07");
    expect(isoDay(new Date("2026-11-06T20:30:00Z"), "UTC")).toBe("2026-11-06");
    expect(isoDay(new Date("2026-11-06T20:30:00Z"), "Not/AZone")).toBe("2026-11-06");
  });
});
