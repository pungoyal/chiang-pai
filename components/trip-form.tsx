"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createTripAction, updateTripAction } from "@/app/actions";
import { CURRENCIES, CURRENCY_INFO, type Currency } from "@/lib/split";
import { DESTINATION_LIST, HOME } from "@/lib/talk";
import {
  DEFAULT_HOME_CURRENCY,
  DEFAULT_HOME_LANGUAGE,
  DEFAULT_MAX_STAKE_PIES,
  MAX_STAKE_CEILING,
} from "@/lib/trips";

const field =
  "mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt";
const label = "block text-[11px] font-semibold uppercase tracking-wider text-soft";

/**
 * Open a trip, or change one. Where the group is going and what it speaks and
 * settles in are fixed once — the foreign currency follows from the
 * destination and is shown, never typed — so editing offers only the name,
 * the dates, and the cap.
 */
export function TripForm({
  initial,
}: {
  initial?: {
    id: string;
    name: string;
    destination: string;
    homeLanguage: string;
    homeCurrency: string;
    startsOn: string | null;
    endsOn: string | null;
    maxStakePies: number;
  };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [destination, setDestination] = useState(initial?.destination ?? "TH");
  const [homeLanguage, setHomeLanguage] = useState(initial?.homeLanguage ?? DEFAULT_HOME_LANGUAGE);
  const [homeCurrency, setHomeCurrency] = useState<Currency>(
    (initial?.homeCurrency as Currency) ?? DEFAULT_HOME_CURRENCY,
  );
  const [startsOn, setStartsOn] = useState(initial?.startsOn ?? "");
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? "");
  const [maxStakePies, setMaxStakePies] = useState(initial?.maxStakePies ?? DEFAULT_MAX_STAKE_PIES);
  const [more, setMore] = useState(false);

  const there = DESTINATION_LIST.find((d) => d.code === destination);
  const foreign = there && there.currency !== homeCurrency ? there.currency : null;
  const sameLanguage = there && HOME[homeLanguage]?.code === there.them.code;

  const submit = () =>
    start(async () => {
      setError(null);
      const input = {
        name,
        startsOn: startsOn || null,
        endsOn: endsOn || null,
        maxStakePies,
      };
      const res = initial
        ? await updateTripAction(initial.id, input)
        : await createTripAction({ ...input, destination, homeLanguage, homeCurrency });
      // Creating redirects; anything that comes back is a refusal.
      if (res && !res.ok) setError(res.error ?? "That didn't work.");
      else if (initial) router.refresh();
    });

  return (
    <div className="space-y-4">
      <label className="block">
        <span className={label}>Trip name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder="Chiang Mai, Diwali"
          className={field}
        />
      </label>

      {!initial && (
        <>
          <fieldset>
            <legend className={label}>Where to</legend>
            <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {DESTINATION_LIST.map((d) => (
                <button
                  key={d.code}
                  type="button"
                  onClick={() => setDestination(d.code)}
                  aria-pressed={destination === d.code}
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${
                    destination === d.code
                      ? "border-felt bg-felt-tint font-semibold"
                      : "border-line bg-surface hover:border-felt"
                  }`}
                >
                  <span aria-hidden>{d.flag}</span>
                  <span className="truncate">{d.place}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={label}>We settle bills in</span>
              <select
                value={homeCurrency}
                onChange={(e) => setHomeCurrency(e.target.value as Currency)}
                className={field}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {CURRENCY_INFO[c].symbol.trim()} {CURRENCY_INFO[c].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={label}>We speak</span>
              <select
                value={homeLanguage}
                onChange={(e) => setHomeLanguage(e.target.value)}
                className={field}
              >
                {Object.entries(HOME).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.language} ({s.tag})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {there && (
            <p className="rounded-md bg-surface px-3 py-2 text-sm text-soft">
              {foreign
                ? `Bills start in ${CURRENCY_INFO[foreign as Currency]?.name ?? foreign} and settle in ${CURRENCY_INFO[homeCurrency].name}. `
                : `One currency everywhere: ${CURRENCY_INFO[homeCurrency].name}. `}
              {sameLanguage
                ? "Nothing to interpret — the talk page stays off."
                : `The talk page interprets ${HOME[homeLanguage]?.language} ↔ ${there.them.language}.`}
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={label}>From</span>
          <input
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className={field}
          />
        </label>
        <label className="block">
          <span className={label}>To</span>
          <input
            type="date"
            value={endsOn}
            min={startsOn || undefined}
            onChange={(e) => setEndsOn(e.target.value)}
            className={field}
          />
        </label>
      </div>

      {more || initial ? (
        <label className="block">
          <span className={label}>Most pies anyone can put on one prediction</span>
          <input
            type="number"
            min={1}
            max={MAX_STAKE_CEILING}
            value={maxStakePies}
            onChange={(e) => setMaxStakePies(Number(e.target.value))}
            className={`${field} mono w-32`}
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => setMore(true)}
          className="text-xs text-soft hover:text-ink hover:underline"
        >
          More options
        </button>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={pending || name.trim().length < 2}
        className="display block w-full rounded-md bg-felt py-3 text-lg font-bold uppercase text-white hover:bg-felt-deep disabled:opacity-40"
      >
        {pending ? "One moment…" : initial ? "Save" : "Open the trip"}
      </button>
      {error && <p className="text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
