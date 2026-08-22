"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteBillAction, settleUpAction } from "@/app/actions";
import type { BillView, CommentView, CurrencyBalances } from "@/lib/data";
import type { Member } from "@/lib/db/schema";
import { fmtDate, timeAgo } from "@/lib/format";
import { lingoOf } from "@/lib/lingo";
import { CURRENCY_SYMBOL, type Currency, fmtMoney, parseAmount } from "@/lib/split";
import { Avatar } from "./avatar";
import { BillForm, todayLocal } from "./bill-form";
import { billLabel, firstName } from "./bill-label";
import { CommentsSection } from "./comments";
import { EmptyState, tone } from "./ui";

/**
 * The whole /bills page below the heading: who's up and down per currency,
 * the shortest way to settle it, and every bill on the record. Real money —
 * this never touches the pie ledger.
 */
export function Bills({
  tripId,
  members,
  meId,
  lingo,
  currencies,
  bills,
  balances,
  comments,
}: {
  tripId: string;
  members: Member[];
  /** The trip's one or two currencies, the default first. */
  currencies: readonly Currency[];
  meId: string;
  lingo: string;
  bills: BillView[];
  balances: CurrencyBalances[];
  /** Each bill's comment thread, keyed by bill id. */
  comments: Record<string, CommentView[]>;
}) {
  const t = lingoOf(lingo);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const act = (run: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await run();
      if (!res.ok) setError(res.error ?? t.oops);
      else router.refresh();
    });

  const recordTransfer = (from: Member, to: Member, currency: Currency, amountC: number) => {
    const line = `${firstName(from)} paid ${firstName(to)} ${fmtMoney(currency, amountC)}`;
    if (!confirm(`Record it? ${line}.`)) return;
    act(() => settleUpAction(tripId, from.id, to.id, currency, amountC, todayLocal()));
  };

  const remove = (bill: BillView) => {
    if (!confirm(`Delete "${billLabel(bill, meId)}"? The group's balances will change.`)) return;
    act(() => deleteBillAction(tripId, bill.id));
  };

  const byDate = new Map<string, BillView[]>();
  for (const bill of bills) {
    const list = byDate.get(bill.onDate) ?? [];
    list.push(bill);
    byDate.set(bill.onDate, list);
  }

  return (
    <div className="mt-5 grid gap-5">
      {balances.map(
        (b) =>
          (b.nets.length > 0 || bills.some((x) => x.currency === b.currency)) && (
            <section key={b.currency} className="card p-4">
              <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
                {CURRENCY_SYMBOL[b.currency]} {b.currency.toUpperCase()}
              </h2>
              {b.nets.length === 0 ? (
                <p className="mt-2 text-sm text-soft">{t.allSquare}</p>
              ) : (
                <>
                  <ul className="mt-2 grid gap-1.5">
                    {b.nets.map(({ member, netC }) => (
                      <li key={member.id} className="flex items-center gap-2 text-sm">
                        <Avatar member={member} size={22} />
                        <span className="truncate">{member.id === meId ? "You" : member.name}</span>
                        <span className={`mono ml-auto font-bold ${tone(netC)}`}>
                          {fmtMoney(b.currency, netC, { sign: true })}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 border-t border-line pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-soft">
                      Settle up
                    </p>
                    <ul className="mt-1.5 grid gap-1.5">
                      {b.plan.map((transfer) => (
                        <li
                          key={`${transfer.fromId}-${transfer.toId}`}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="truncate">
                            <span className="font-semibold">
                              {transfer.fromId === meId ? "You" : firstName(transfer.from)}
                            </span>{" "}
                            → {transfer.toId === meId ? "you" : firstName(transfer.to)}
                          </span>
                          <span className="mono font-bold">
                            {fmtMoney(b.currency, transfer.amountC)}
                          </span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              recordTransfer(
                                transfer.from,
                                transfer.to,
                                b.currency,
                                transfer.amountC,
                              )
                            }
                            className="ml-auto rounded-md border border-line px-2 py-1 text-xs font-semibold hover:bg-paper disabled:opacity-40"
                          >
                            Record payment
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </section>
          ),
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setPaying(false);
              setEditingId(null);
            }}
            className="display rounded-md bg-felt px-4 py-2 text-base font-bold uppercase text-white hover:bg-felt-deep"
          >
            Add a bill
          </button>
        )}
        {!paying && (
          <button
            type="button"
            onClick={() => {
              setPaying(true);
              setAdding(false);
            }}
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-paper"
          >
            Record a payment
          </button>
        )}
      </div>

      {adding && (
        <BillForm
          tripId={tripId}
          members={members}
          meId={meId}
          lingo={lingo}
          currencies={currencies}
          onDone={() => setAdding(false)}
        />
      )}
      {paying && (
        <PaymentForm
          members={members}
          meId={meId}
          currencies={currencies}
          pending={pending}
          onRecord={(payer, receiver, currency, amountC, onDate) => {
            act(() => settleUpAction(tripId, payer.id, receiver.id, currency, amountC, onDate));
            setPaying(false);
          }}
          onCancel={() => setPaying(false)}
        />
      )}

      {bills.length === 0 ? (
        <EmptyState title={t.billsEmptyTitle} sub={t.billsEmptySub} />
      ) : (
        [...byDate].map(([onDate, dayBills]) => (
          <section key={onDate}>
            <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
              {fmtDate(onDate)}
            </h2>
            <ul className="mt-2 card list">
              {dayBills.map((bill) =>
                editingId === bill.id ? (
                  <li key={bill.id} className="p-2">
                    <BillForm
                      tripId={tripId}
                      members={members}
                      meId={meId}
                      lingo={lingo}
                      currencies={currencies}
                      initial={bill}
                      onDone={() => setEditingId(null)}
                    />
                  </li>
                ) : (
                  <li key={bill.id}>
                    <button
                      type="button"
                      onClick={() => setOpenId(openId === bill.id ? null : bill.id)}
                      aria-expanded={openId === bill.id}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-paper/60"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">
                          {billLabel(bill, meId)}
                          {bill.editedAt && (
                            <span className="ml-1.5 text-xs font-normal text-soft">edited</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-soft">
                          {bill.kind === "settlement"
                            ? "payment"
                            : `${bill.entries
                                .filter((e) => e.paidC > 0)
                                .map((e) => (e.member.id === meId ? "you" : firstName(e.member)))
                                .join(" & ")} paid · split ${
                                bill.entries.filter((e) => e.participant).length
                              } ways`}
                        </p>
                      </div>
                      {(comments[bill.id]?.length ?? 0) > 0 && (
                        <span className="whitespace-nowrap text-xs text-soft">
                          💬 {comments[bill.id].length}
                        </span>
                      )}
                      <span className="mono font-bold">{fmtMoney(bill.currency, bill.totalC)}</span>
                    </button>
                    {openId === bill.id && (
                      <div className="border-t border-dashed border-line px-4 py-3 text-sm">
                        <ul className="grid gap-1">
                          {bill.entries.map((e) => (
                            <li key={e.member.id} className="flex items-center gap-2">
                              <Avatar member={e.member} size={20} />
                              <span className="truncate">
                                {e.member.id === meId ? "You" : firstName(e.member)}
                              </span>
                              <span className="mono ml-auto text-xs text-soft">
                                {e.paidC > 0 && `paid ${fmtMoney(bill.currency, e.paidC)}`}
                                {e.paidC > 0 && e.owedC > 0 && " · "}
                                {e.owedC > 0 && `owes ${fmtMoney(bill.currency, e.owedC)}`}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-2 text-xs text-soft">
                          added by {bill.createdBy.id === meId ? "you" : firstName(bill.createdBy)}{" "}
                          {timeAgo(bill.createdAt)}
                          {bill.editedBy &&
                            bill.editedAt &&
                            ` · edited by ${
                              bill.editedBy.id === meId ? "you" : firstName(bill.editedBy)
                            } ${timeAgo(bill.editedAt)}`}
                        </p>
                        <div className="mt-2 flex items-center gap-2">
                          {bill.kind === "expense" && (
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setEditingId(bill.id);
                                setAdding(false);
                              }}
                              className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold hover:bg-paper disabled:opacity-40"
                            >
                              Edit
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => remove(bill)}
                            className="rounded-md px-2.5 py-1 text-xs font-semibold text-no-deep hover:underline disabled:opacity-40"
                          >
                            Delete
                          </button>
                        </div>
                        <div className="mt-3 border-t border-dashed border-line pt-3">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                            {t.commentsHeading}
                          </p>
                          <div className="mt-2">
                            <CommentsSection
                              target={{ billId: bill.id }}
                              comments={comments[bill.id] ?? []}
                              members={members}
                              meId={meId}
                              lingo={lingo}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                ),
              )}
            </ul>
          </section>
        ))
      )}

      {error && <p className="text-sm font-semibold text-no-deep">{error}</p>}
      {pending && <p className="text-sm text-soft">{t.recording}</p>}
    </div>
  );
}

/** Record any repayment by hand — the plan buttons cover the common case. */
function PaymentForm({
  members,
  meId,
  currencies,
  pending,
  onRecord,
  onCancel,
}: {
  members: Member[];
  meId: string;
  currencies: readonly Currency[];
  pending: boolean;
  onRecord: (
    payer: Member,
    receiver: Member,
    currency: Currency,
    amountC: number,
    onDate: string,
  ) => void;
  onCancel: () => void;
}) {
  const others = members.filter((m) => m.id !== meId);
  const [payerId, setPayerId] = useState(meId);
  const [receiverId, setReceiverId] = useState(others[0]?.id ?? meId);
  const [currency, setCurrency] = useState<Currency>(currencies[currencies.length - 1]);
  const [amountText, setAmountText] = useState("");
  const [onDate, setOnDate] = useState(todayLocal());

  const amountC = parseAmount(amountText);
  const select =
    "rounded-md border border-line bg-surface px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-felt";

  return (
    <div className="card p-4">
      <h3 className="display text-lg font-bold uppercase tracking-wide text-soft">
        Record a payment
      </h3>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={payerId}
          onChange={(e) => setPayerId(e.target.value)}
          aria-label="Who paid"
          className={select}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === meId ? "You" : firstName(m)}
            </option>
          ))}
        </select>
        <span className="text-soft">paid</span>
        <select
          value={receiverId}
          onChange={(e) => setReceiverId(e.target.value)}
          aria-label="Who got paid"
          className={select}
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id === meId ? "You" : firstName(m)}
            </option>
          ))}
        </select>
        {currencies.length > 1 && (
          <div className="flex overflow-hidden rounded-md border border-line">
            {currencies.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                aria-pressed={currency === c}
                className={`px-2.5 py-1.5 text-sm font-bold ${
                  currency === c ? "bg-felt text-white" : "bg-surface text-soft hover:text-ink"
                }`}
              >
                {CURRENCY_SYMBOL[c]}
              </button>
            ))}
          </div>
        )}
        <input
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          inputMode="decimal"
          placeholder="0"
          aria-label="Amount paid back"
          className="mono w-28 rounded-md border border-line bg-surface px-2 py-1.5 font-bold focus:outline-none focus:ring-2 focus:ring-felt"
        />
        <input
          type="date"
          value={onDate}
          max={todayLocal()}
          onChange={(e) => setOnDate(e.target.value)}
          aria-label="Date paid"
          className={select}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={pending || !amountC || payerId === receiverId}
          onClick={() => {
            const payer = members.find((m) => m.id === payerId);
            const receiver = members.find((m) => m.id === receiverId);
            if (payer && receiver && amountC) onRecord(payer, receiver, currency, amountC, onDate);
          }}
          className="display rounded-md bg-felt px-4 py-2 text-base font-bold uppercase text-white hover:bg-felt-deep disabled:cursor-not-allowed disabled:opacity-40"
        >
          Record
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-md px-3 py-2 text-sm text-soft hover:underline disabled:opacity-40"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
