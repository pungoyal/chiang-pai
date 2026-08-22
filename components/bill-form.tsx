"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { addBillAction, editBillAction } from "@/app/actions";
import type { BillView } from "@/lib/data";
import type { Member } from "@/lib/db/schema";
import { lingoOf } from "@/lib/lingo";
import {
  type BillEntryInput,
  CURRENCY_SYMBOL,
  type Currency,
  fmtMoney,
  parseAmount,
  type SplitMode,
} from "@/lib/split";
import { Avatar } from "./avatar";

/** Today in the member's own timezone, as the YYYY-MM-DD a date input wants. */
export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

function centsToText(c: number): string {
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

function firstName(member: Member): string {
  return member.name.split(" ")[0];
}

const CURRENCY_KEY = "billCurrency";

const chip = (on: boolean) =>
  `flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm font-semibold ${
    on ? "border-felt bg-felt-tint" : "border-line bg-surface text-soft"
  }`;

const field =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt";

/**
 * Add or edit one bill. The fast path is one screen: amount, what for, who
 * paid (you, prefilled), split equally with everyone (prefilled). Multiple
 * payers and unequal shares unfold only when asked for.
 */
export function BillForm({
  members,
  meId,
  lingo,
  tripId,
  currencies,
  initial,
  onDone,
}: {
  members: Member[];
  meId: string;
  lingo: string;
  /** Where the group is, so a new bill starts in the money they are spending. */
  tripId: string;
  /** The trip's one or two currencies, the default first. */
  currencies: readonly Currency[];
  /** Editing an existing bill; omitted when adding. */
  initial?: BillView;
  onDone: () => void;
}) {
  const t = lingoOf(lingo);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [onDate, setOnDate] = useState(initial?.onDate ?? todayLocal());
  const [description, setDescription] = useState(initial?.description ?? "");
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? currencies[0]);
  const [payerIds, setPayerIds] = useState<string[]>(() =>
    initial ? initial.entries.filter((e) => e.paidC > 0).map((e) => e.member.id) : [meId],
  );
  const [paidText, setPaidText] = useState<Record<string, string>>(() =>
    initial
      ? Object.fromEntries(
          initial.entries
            .filter((e) => e.paidC > 0)
            .map((e) => [e.member.id, centsToText(e.paidC)]),
        )
      : {},
  );
  // The one-payer fast path types the bill's total, not a person's share, so it
  // is kept apart from the per-payer amounts: unticking yourself to tick
  // somebody else changes who paid, not how much the dinner cost.
  const [soloText, setSoloText] = useState<string>(() => {
    const paid = initial?.entries.filter((e) => e.paidC > 0) ?? [];
    return paid.length === 1 ? centsToText(paid[0].paidC) : "";
  });
  const [inSplit, setInSplit] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      members.map((m) => [
        m.id,
        initial ? (initial.entries.find((e) => e.member.id === m.id)?.participant ?? false) : true,
      ]),
    ),
  );
  const [split, setSplit] = useState<SplitMode>(initial?.split ?? "equal");
  const [owedText, setOwedText] = useState<Record<string, string>>(() =>
    initial && initial.split === "custom"
      ? Object.fromEntries(
          initial.entries
            .filter((e) => e.participant)
            .map((e) => [e.member.id, centsToText(e.owedC)]),
        )
      : {},
  );

  // Remember the last currency for the next new bill; never fight an edit,
  // and never remember one this trip doesn't spend.
  useEffect(() => {
    if (initial) return;
    const saved = localStorage.getItem(CURRENCY_KEY);
    if (saved && (currencies as readonly string[]).includes(saved)) setCurrency(saved as Currency);
  }, [initial, currencies]);
  const pickCurrency = (c: Currency) => {
    setCurrency(c);
    if (!initial) localStorage.setItem(CURRENCY_KEY, c);
  };

  const singlePayer = payerIds.length === 1;
  /**
   * Tick a payer on or off, handing the amount over as the form crosses
   * between the one-payer field and the per-payer rows — in either direction
   * the number stays on screen instead of starting again.
   */
  const togglePayer = (id: string) => {
    const next = payerIds.includes(id) ? payerIds.filter((x) => x !== id) : [...payerIds, id];
    if (payerIds.length === 1 && next.length === 2) {
      setPaidText({ ...paidText, [payerIds[0]]: paidText[payerIds[0]] || soloText });
    } else if (payerIds.length === 2 && next.length === 1) {
      setSoloText(paidText[next[0]] || soloText);
    }
    setPayerIds(next);
  };

  const amountTextOf = (id: string) =>
    (singlePayer && id === payerIds[0] ? soloText : paidText[id]) ?? "";
  const paidCOf = (id: string) => parseAmount(amountTextOf(id)) ?? 0;
  const totalC = payerIds.reduce((sum, id) => sum + paidCOf(id), 0);
  const participantIds = members.map((m) => m.id).filter((id) => inSplit[id]);
  const perHeadC = participantIds.length > 0 ? Math.round(totalC / participantIds.length) : 0;
  const owedCOf = (id: string) => parseAmount(owedText[id] ?? "") ?? 0;
  const assignedC = participantIds.reduce((sum, id) => sum + owedCOf(id), 0);
  const remainingC = totalC - assignedC;

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const entries: BillEntryInput[] = members
        .map((m) => ({
          memberId: m.id,
          paidC: payerIds.includes(m.id) ? paidCOf(m.id) : 0,
          participant: Boolean(inSplit[m.id]),
          ...(split === "custom" && inSplit[m.id] ? { owedC: owedCOf(m.id) } : {}),
        }))
        .filter((e) => e.paidC > 0 || e.participant);
      const input = { onDate, description, currency, split, entries };
      const res = initial
        ? await editBillAction(tripId, initial.id, input)
        : await addBillAction(tripId, input);
      if (!res.ok) setError(res.error ?? t.oops);
      else {
        onDone();
        router.refresh();
      }
    });

  return (
    <div className="card p-4">
      <h3 className="display text-lg font-bold uppercase tracking-wide text-soft">
        {initial ? "Edit bill" : "Add a bill"}
      </h3>

      <div className="mt-3 grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* One currency is not a choice: a domestic trip never shows this. */}
          {currencies.length > 1 && (
            <div className="flex overflow-hidden rounded-md border border-line">
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => pickCurrency(c)}
                  aria-pressed={currency === c}
                  className={`px-3 py-2 text-sm font-bold ${
                    currency === c ? "bg-felt text-white" : "bg-surface text-soft hover:text-ink"
                  }`}
                >
                  {CURRENCY_SYMBOL[c]} {c.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {singlePayer ? (
            <input
              value={soloText}
              onChange={(e) => setSoloText(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              aria-label="Amount"
              className="mono w-32 rounded-md border border-line bg-surface px-3 py-2 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-felt"
            />
          ) : (
            <span className="mono text-lg font-bold">{fmtMoney(currency, totalC)}</span>
          )}
          {/* Uncontrolled on purpose. A date input reads as "" from the first
              keystroke until the last, and committing that emptied the date
              the form was going to save — leaving "Pick a date for the bill."
              as the answer to pressing Add. Only whole dates are committed;
              blurring a half-typed one puts the committed date back on screen,
              so what is showing is always what saves. Controlling the value
              instead would write that "" back into the field mid-edit. */}
          <input
            type="date"
            defaultValue={onDate}
            max={todayLocal()}
            onChange={(e) => {
              if (e.target.value) setOnDate(e.target.value);
            }}
            onBlur={(e) => {
              if (!e.target.value) e.target.value = onDate;
            }}
            aria-label="Date"
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-felt"
          />
        </div>

        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Dinner at the night market"
          maxLength={200}
          aria-label="What was it for?"
          className={field}
        />

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-soft">Paid by</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => togglePayer(m.id)}
                aria-pressed={payerIds.includes(m.id)}
                className={chip(payerIds.includes(m.id))}
              >
                <Avatar member={m} size={18} />
                {m.id === meId ? "You" : firstName(m)}
              </button>
            ))}
          </div>
          {!singlePayer && (
            <div className="mt-2 grid gap-1.5">
              {payerIds.map((id) => {
                const m = members.find((x) => x.id === id);
                if (!m) return null;
                return (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <span className="w-24 truncate">{firstName(m)} paid</span>
                    <input
                      value={paidText[id] ?? ""}
                      onChange={(e) => setPaidText({ ...paidText, [id]: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      className="mono w-28 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-felt"
                    />
                    <span className="text-soft">{CURRENCY_SYMBOL[currency]}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-soft">Split between</p>
            <div className="flex overflow-hidden rounded-md border border-line text-xs">
              {(
                [
                  ["equal", "Equally"],
                  ["custom", "Unequally"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSplit(mode)}
                  aria-pressed={split === mode}
                  className={`px-2.5 py-1 font-semibold ${
                    split === mode ? "bg-felt text-white" : "bg-surface text-soft hover:text-ink"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setInSplit({ ...inSplit, [m.id]: !inSplit[m.id] })}
                aria-pressed={Boolean(inSplit[m.id])}
                className={chip(Boolean(inSplit[m.id]))}
              >
                <Avatar member={m} size={18} />
                {m.id === meId ? "You" : firstName(m)}
              </button>
            ))}
          </div>
          {split === "equal" ? (
            totalC > 0 &&
            participantIds.length > 0 && (
              <p className="mt-1.5 text-xs text-soft">
                ≈ {fmtMoney(currency, perHeadC)} each, {participantIds.length}{" "}
                {participantIds.length === 1 ? "person" : "people"}
              </p>
            )
          ) : (
            <div className="mt-2 grid gap-1.5">
              {participantIds.map((id) => {
                const m = members.find((x) => x.id === id);
                if (!m) return null;
                return (
                  <label key={id} className="flex items-center gap-2 text-sm">
                    <span className="w-24 truncate">{firstName(m)} owes</span>
                    <input
                      value={owedText[id] ?? ""}
                      onChange={(e) => setOwedText({ ...owedText, [id]: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      className="mono w-28 rounded-md border border-line bg-surface px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-felt"
                    />
                    <span className="text-soft">{CURRENCY_SYMBOL[currency]}</span>
                  </label>
                );
              })}
              <p
                className={`text-xs ${remainingC === 0 ? "text-soft" : "font-semibold text-no-deep"}`}
              >
                {remainingC === 0
                  ? "Shares match the total."
                  : remainingC > 0
                    ? `${fmtMoney(currency, remainingC)} left to assign`
                    : `${fmtMoney(currency, -remainingC)} over the total`}
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending || totalC <= 0 || (split === "custom" && remainingC !== 0)}
            onClick={submit}
            className="display rounded-md bg-felt px-4 py-2 text-base font-bold uppercase text-white hover:bg-felt-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {initial ? "Save changes" : "Add bill"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onDone}
            className="rounded-md px-3 py-2 text-sm text-soft hover:underline disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      {pending && <p className="mt-2 text-sm text-soft">{t.recording}</p>}
    </div>
  );
}
