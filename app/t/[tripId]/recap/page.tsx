import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { Pies } from "@/components/pies";
import { ShareRecap } from "@/components/share-recap";
import { EmptyState } from "@/components/ui";
import { tripRecap } from "@/lib/data";
import { lingoOf } from "@/lib/lingo";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { DESTINATIONS } from "@/lib/talk";
import { isoDay, tripPhase } from "@/lib/trips";

/**
 * The season, summed up: the table, the rivalries, the biggest swing. What a
 * trip leaves behind, and the thing worth screenshotting on the flight home.
 */
export default async function RecapPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const t = lingoOf(me.lingo);
  const recap = await tripRecap(tripId);
  if (!recap) return null;
  const there = DESTINATIONS[trip.destination];
  const phase = tripPhase(trip, isoDay(new Date(), "Asia/Kolkata"));
  const champion = recap.table[0];
  const name = (id: string) => recap.memberById.get(id)?.name ?? "someone";

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">
        {phase === "after" ? "The season is over" : "The season so far"} · {there?.flag}{" "}
        {there?.place}
      </p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.recapTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.recapSub}</p>

      {recap.resolvedCount === 0 ? (
        <div className="mt-6">
          <EmptyState title={t.recapEmptyTitle} sub={t.recapEmptySub} />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
            <Tile
              label="Verdicts"
              value={String(recap.resolvedCount)}
              sub={`${recap.openCount} still open`}
            />
            <Tile label="Pies in play" value={piesText(recap.totalPoolC)} />
            <Tile
              label="Champion"
              value={champion ? champion.member.name : "—"}
              sub={champion ? piesText(champion.profitC, { sign: true }) : undefined}
            />
          </div>

          <section className="mt-7">
            <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
              The table
            </h2>
            <ol className="mt-3 card list">
              {recap.table.map((s, i) => (
                <li key={s.member.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="display w-7 text-lg font-bold">
                    {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                  </span>
                  <Avatar member={s.member} size={28} />
                  <Link
                    href={routes.member(tripId, s.member.id)}
                    className="min-w-0 flex-1 truncate font-semibold hover:underline"
                  >
                    {s.member.name}
                    {s.member.id === me.id && <span className="font-normal text-soft"> (you)</span>}
                  </Link>
                  <span className="mono text-xs text-soft">
                    {s.wins}–{s.losses}
                  </span>
                  <span className="mono w-16 text-right font-bold">
                    <Pies c={s.profitC} sign />
                  </span>
                </li>
              ))}
            </ol>
          </section>

          {(recap.biggestWin || recap.biggestLoss) && (
            <section className="mt-7 grid gap-3 sm:grid-cols-2">
              {recap.biggestWin && (
                <Swing
                  label="Biggest win"
                  who={recap.biggestWin.member.name}
                  profitC={recap.biggestWin.profitC}
                  href={routes.market(tripId, recap.biggestWin.market.id)}
                  question={recap.biggestWin.market.question}
                />
              )}
              {recap.biggestLoss && (
                <Swing
                  label="Biggest loss"
                  who={recap.biggestLoss.member.name}
                  profitC={recap.biggestLoss.profitC}
                  href={routes.market(tripId, recap.biggestLoss.market.id)}
                  question={recap.biggestLoss.market.question}
                />
              )}
            </section>
          )}

          {recap.rivalries.length > 0 && (
            <section className="mt-7">
              <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">
                Rivalries
              </h2>
              <p className="text-xs text-soft">
                Who kept taking the other side of whom — and who came out ahead.
              </p>
              <ul className="mt-3 card list">
                {recap.rivalries.slice(0, 6).map((r) => (
                  <li key={`${r.a}-${r.b}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`font-semibold ${r.aWins > r.bWins ? "text-felt" : ""}`}>
                      {name(r.a)}
                    </span>
                    <span className="mono rounded bg-surface px-2 py-0.5 text-xs">
                      {r.aWins}–{r.bWins}
                    </span>
                    <span className={`font-semibold ${r.bWins > r.aWins ? "text-felt" : ""}`}>
                      {name(r.b)}
                    </span>
                    <span className="ml-auto text-xs text-soft">
                      {r.clashes} clash{r.clashes === 1 ? "" : "es"}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <ShareRecap
            tripName={trip.name}
            lines={recap.table
              .slice(0, 5)
              .map((s, i) => `${i + 1}. ${s.member.name} ${piesText(s.profitC, { sign: true })}`)}
            verdicts={recap.resolvedCount}
          />
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-3 py-2.5 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p className="display mt-0.5 truncate text-2xl font-extrabold sm:text-3xl">{value}</p>
      {sub && <p className="text-xs text-soft">{sub}</p>}
    </div>
  );
}

function Swing({
  label,
  who,
  profitC,
  href,
  question,
}: {
  label: string;
  who: string;
  profitC: number;
  href: string;
  question: string;
}) {
  return (
    <Link href={href} className="card block px-4 py-3 hover:border-felt">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p className="mt-0.5 font-semibold">
        {who}{" "}
        <span className={`mono ${profitC > 0 ? "text-felt" : "text-no-deep"}`}>
          <Pies c={profitC} sign />
        </span>
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-soft">{question}</p>
    </Link>
  );
}
