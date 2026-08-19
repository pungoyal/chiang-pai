import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { AvatarPicker } from "@/components/avatar-picker";
import { billLabel, firstName } from "@/components/bill-label";
import { LingoPicker } from "@/components/lingo-picker";
import { PasskeyManager } from "@/components/passkeys";
import { Pies } from "@/components/pies";
import { SideChip } from "@/components/side-chip";
import { tone } from "@/components/ui";
import {
  getMember,
  listMarkets,
  listPasskeySummaries,
  memberLedger,
  memberResults,
  memberSplit,
  netOf,
  summarizeResults,
} from "@/lib/data";
import { fmtDate, timeAgo } from "@/lib/format";
import { type Lingo, lingoOf } from "@/lib/lingo";
import { fmtPct, fmtPies } from "@/lib/pies";
import { requireMember } from "@/lib/session";
import { fmtMoney } from "@/lib/split";

export default async function MemberPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireMember();
  const { id } = await params;
  const member = await getMember(id);
  if (!member) notFound();
  const isMe = member.id === me.id;
  const t = lingoOf(me.lingo);

  const [netC, results, ledgerItems, { open }, split, passkeys] = await Promise.all([
    netOf(member.id),
    memberResults(member.id),
    memberLedger(member.id),
    listMarkets(member.id),
    memberSplit(member.id),
    isMe ? listPasskeySummaries(me.id) : [],
  ]);
  const stats = summarizeResults(results);
  const openPositions = open.filter((v) => v.myStakeC > 0);

  // Running balance, derived purely from the append-only ledger.
  const ascending = [...ledgerItems].reverse();
  let running = 0;
  const withBalance = ascending.map((item) => {
    running += item.row.balanceDeltaC;
    return { item, afterC: running };
  });
  withBalance.reverse();

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center gap-4">
        <Avatar member={member} size={56} />
        <div>
          <h1 className="display text-4xl font-extrabold">{member.name}</h1>
          <p className="text-sm text-soft">
            At the table since {fmtDate(member.joinedAt)}
            {isMe && " · this is you"}
          </p>
        </div>
        {isMe && (
          <div className="ml-auto flex flex-col items-end gap-2">
            <LingoPicker current={me.lingo} />
            <AvatarPicker hasCustom={me.avatarUpdatedAt != null} />
          </div>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
        <Stat label="Net pies" value={<Pies c={netC} sign />} />
        <Stat
          label="Lifetime P/L"
          value={<Pies c={stats.profitC} sign />}
          tone={stats.profitC > 0 ? "up" : stats.profitC < 0 ? "down" : undefined}
        />
        <Stat label="Return" value={stats.roi == null ? "—" : fmtPct(stats.roi)} />
        <Stat label="Record" value={`${stats.wins}–${stats.losses}`} />
        <Stat
          label="Best / worst"
          value={
            stats.resolvedCount > 0
              ? `${fmtPies(stats.biggestWinC, { sign: true })} / ${fmtPies(stats.biggestLossC, { sign: true })}`
              : "—"
          }
        />
      </div>

      {isMe && (
        <section className="mt-7">
          <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">Passkeys</h2>
          <p className="text-xs text-soft">
            How you sign in. Each one is a key your own device holds — all we keep is its public
            half, which can verify a signature and nothing else. Add one per device you use, so a
            lost phone never locks you out.
          </p>
          <div className="mt-3">
            <PasskeyManager passkeys={passkeys} />
          </div>
        </section>
      )}

      {split.bills.length > 0 && (
        <section className="mt-7">
          <div className="flex items-baseline gap-3">
            <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
              Split bills
            </h2>
            <Link href="/bills" className="text-xs text-felt hover:underline">
              settle up →
            </Link>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {split.balances.map((b) => (
              <div key={b.currency} className="card flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="text-soft">
                  {b.netC > 0
                    ? `The group owes ${isMe ? "you" : firstName(member)}`
                    : b.netC < 0
                      ? `${isMe ? "You owe" : `${firstName(member)} owes`} the group`
                      : t.allSquare}
                </span>
                <span className={`mono ml-auto font-bold ${tone(b.netC)}`}>
                  {fmtMoney(b.currency, b.netC, { sign: true })}
                </span>
              </div>
            ))}
          </div>
          <ul className="mt-3 card list">
            {split.bills.map(({ bill, line }) => (
              <li key={bill.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href="/bills" className="font-semibold hover:underline">
                    {billLabel(bill, me.id)}
                  </Link>
                  <p className="truncate text-xs text-soft">
                    {fmtDate(bill.onDate)}
                    {bill.kind === "settlement"
                      ? " · payment"
                      : `${
                          line.paidC > 0
                            ? ` · paid ${fmtMoney(bill.currency, line.paidC)} of ${fmtMoney(bill.currency, bill.totalC)}`
                            : ""
                        }${line.owedC > 0 ? ` · share ${fmtMoney(bill.currency, line.owedC)}` : ""}`}
                  </p>
                </div>
                <span className={`mono font-bold ${tone(line.netC)}`}>
                  {fmtMoney(bill.currency, line.netC, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {openPositions.length > 0 && (
        <section className="mt-7">
          <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
            Open bets — <Pies c={openPositions.reduce((s, v) => s + v.myStakeC, 0)} />
          </h2>
          <ul className="mt-3 card list">
            {openPositions.map((v) => (
              <li key={v.market.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link
                  href={`/market/${v.market.id}`}
                  className="min-w-0 flex-1 font-semibold hover:underline"
                >
                  {v.market.question}
                </Link>
                <span className="mono font-bold">
                  <Pies c={v.myStakeC} />
                </span>
                <SideChip side={v.mySide!} small />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7">
        <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
          Resolved predictions
        </h2>
        {results.length === 0 ? (
          <p className="mt-2 text-sm text-soft">{t.resolvedEmpty}</p>
        ) : (
          <ul className="mt-3 card list">
            {results.map((r) => (
              <li key={r.market.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Link
                  href={`/market/${r.market.id}`}
                  className="min-w-0 flex-1 font-semibold hover:underline"
                >
                  {r.market.question}
                </Link>
                <span className="hidden items-center gap-1.5 text-xs text-soft sm:flex">
                  <Pies c={r.stakeC} /> on <SideChip side={r.side} small />
                </span>
                <span
                  className={`mono w-20 text-right font-bold ${r.noContest ? "text-soft" : tone(r.profitC)}`}
                >
                  {r.noContest ? "void" : <Pies c={r.profitC} sign />}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
          The full ledger
        </h2>
        <p className="text-xs text-soft">
          Every pie movement, newest first. The balance column is derived by replaying the whole
          history — nothing is ever overwritten.
        </p>
        <div className="mt-3 overflow-x-auto card">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-soft">
                <th className="px-4 py-2">When</th>
                <th className="px-2 py-2">What</th>
                <th className="px-2 py-2 text-right">Δ pies</th>
                <th className="px-4 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {withBalance.map(({ item, afterC }) => (
                <tr key={item.row.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-soft">
                    {timeAgo(item.row.at)}
                  </td>
                  <td className="px-2 py-2">
                    {describe(item.row.kind, item.row.side, t)}
                    {item.market && (
                      <>
                        {" — "}
                        <Link
                          href={`/market/${item.market.id}`}
                          className="text-felt hover:underline"
                        >
                          {item.market.question}
                        </Link>
                      </>
                    )}
                    {item.row.note && !item.market && (
                      <span className="text-soft"> {item.row.note}</span>
                    )}
                  </td>
                  <td className={`mono px-2 py-2 text-right ${tone(item.row.balanceDeltaC)}`}>
                    {item.row.balanceDeltaC === 0
                      ? "·"
                      : `${fmtPies(item.row.balanceDeltaC, { sign: true })}`}
                  </td>
                  <td className="mono px-4 py-2 text-right font-semibold">{fmtPies(afterC)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function describe(kind: string, side: string | null, t: Lingo): string {
  switch (kind) {
    case "grant":
      return t.joinedLedger;
    case "bet":
      return `Backed ${side?.toUpperCase()}`;
    case "switch":
      return `Switched to ${side?.toUpperCase()}`;
    case "payout":
      return "Won";
    case "refund":
      return "Refunded";
    default:
      return kind;
  }
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "up" | "down";
}) {
  return (
    <div className="card px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p
        className={`mono mt-0.5 text-lg font-bold ${
          tone === "up" ? "text-felt" : tone === "down" ? "text-no-deep" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
