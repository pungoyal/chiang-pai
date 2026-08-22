// What a trip is, before any of it touches a database.
//
// A trip is one friend group going one place for a stretch of days, and the
// rules here are the ones a row has to satisfy to be one: a name, a
// destination this app knows, a home language it can interpret from, and the
// two currencies that follow from where they live and where they are going —
// or one, when those are the same place. Everything derived (which currency a
// bill starts in, whether the trip is over, whether there is anything to
// interpret) is a function of the row, never stored beside it.
//
// No I/O; everything here is covered by trips.test.ts.

import { CURRENCY_INFO, type Currency, isCurrency } from "./split.ts";
import { DESTINATIONS, HOME } from "./talk.ts";

/** Validation failures with a message fit to show the member. */
export class TripError extends Error {}

export const MAX_TRIP_NAME = 60;
export const MIN_TRIP_NAME = 2;
/** Exposure cap per prediction, in whole pies, unless a trip says otherwise. */
export const DEFAULT_MAX_STAKE_PIES = 10;
export const MAX_STAKE_CEILING = 100;

/** What an Indian group settles in, unless the organiser says otherwise. */
export const DEFAULT_HOME_CURRENCY: Currency = "inr";
export const DEFAULT_HOME_LANGUAGE = "en";

export interface TripInput {
  name: string;
  destination: string;
  homeLanguage?: string;
  homeCurrency?: string;
  startsOn?: string | null;
  endsOn?: string | null;
  maxStakePies?: number;
}

/** The row a trip becomes — every field checked, the foreign currency decided. */
export interface TripConfig {
  name: string;
  destination: string;
  homeLanguage: string;
  homeCurrency: Currency;
  /** Null is a domestic trip: one currency everywhere, never asked about. */
  foreignCurrency: Currency | null;
  startsOn: string | null;
  endsOn: string | null;
  maxStakePies: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function checkDate(value: string | null | undefined, what: string): string | null {
  if (value == null || value === "") return null;
  if (!DATE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TripError(`Pick a real ${what} date.`);
  }
  return value;
}

/**
 * Turn what the form sent into a trip, or refuse with a reason. The foreign
 * currency is never typed in: it is what the destination spends, and it is
 * dropped entirely when that is already what the group settles in, so a
 * domestic trip has exactly one currency and no bill ever asks.
 */
export function tripConfig(input: TripInput): TripConfig {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < MIN_TRIP_NAME) throw new TripError("Give the trip a name.");
  if (name.length > MAX_TRIP_NAME) {
    throw new TripError(`Keep the trip name under ${MAX_TRIP_NAME} characters.`);
  }

  const destination = input.destination.trim().toUpperCase();
  const there = DESTINATIONS[destination];
  if (!there) throw new TripError("Pick a destination from the list.");

  const homeLanguage = (input.homeLanguage ?? DEFAULT_HOME_LANGUAGE).trim().toLowerCase();
  if (!HOME[homeLanguage]) throw new TripError("Pick a home language from the list.");

  const homeCurrency = (input.homeCurrency ?? DEFAULT_HOME_CURRENCY).trim().toLowerCase();
  if (!isCurrency(homeCurrency)) throw new TripError("Pick a home currency from the list.");
  if (!isCurrency(there.currency)) {
    throw new TripError(`${there.place} spends ${there.currency}, which this app can't count.`);
  }
  const foreignCurrency = there.currency === homeCurrency ? null : there.currency;

  const startsOn = checkDate(input.startsOn, "start");
  const endsOn = checkDate(input.endsOn, "end");
  if (startsOn && endsOn && endsOn < startsOn) {
    throw new TripError("The trip can't end before it starts.");
  }

  const maxStakePies = input.maxStakePies ?? DEFAULT_MAX_STAKE_PIES;
  if (!Number.isInteger(maxStakePies) || maxStakePies < 1 || maxStakePies > MAX_STAKE_CEILING) {
    throw new TripError(`The cap per prediction is 1 to ${MAX_STAKE_CEILING} pies.`);
  }

  return {
    name,
    destination,
    homeLanguage,
    homeCurrency,
    foreignCurrency,
    startsOn,
    endsOn,
    maxStakePies,
  };
}

/** The shape of a trip row that the rules below need. */
export interface TripLike {
  destination: string;
  homeCurrency: string;
  foreignCurrency: string | null;
  startsOn: string | null;
  endsOn: string | null;
}

/** The one or two currencies a bill on this trip can be in, foreign first. */
export function tripCurrencies(trip: TripLike): Currency[] {
  const out: Currency[] = [];
  if (trip.foreignCurrency && isCurrency(trip.foreignCurrency)) out.push(trip.foreignCurrency);
  if (isCurrency(trip.homeCurrency) && !out.includes(trip.homeCurrency)) {
    out.push(trip.homeCurrency);
  }
  return out;
}

/** What a new bill starts in: the destination's money while there is one. */
export function defaultCurrency(trip: TripLike): Currency {
  return tripCurrencies(trip)[0];
}

/** One currency, never asked about. */
export function isDomestic(trip: TripLike): boolean {
  return tripCurrencies(trip).length === 1;
}

export type TripPhase = "undated" | "before" | "during" | "after";

/** Where the trip is in its life, by the member's calendar day. */
export function tripPhase(trip: TripLike, today: string): TripPhase {
  if (!trip.startsOn && !trip.endsOn) return "undated";
  if (trip.startsOn && today < trip.startsOn) return "before";
  if (trip.endsOn && today > trip.endsOn) return "after";
  return "during";
}

/** Whole days between two ISO dates (b − a), for "in 12 days" lines. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** "2026-11-06" for the member's clock — dates on trips are calendar days. */
export function isoDay(now: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** The place name a trip was pointed at, for headings. */
export function placeOf(trip: { destination: string }): string {
  return DESTINATIONS[trip.destination]?.place ?? trip.destination;
}

export function currencyName(code: string): string {
  return isCurrency(code) ? CURRENCY_INFO[code].name : code.toUpperCase();
}
