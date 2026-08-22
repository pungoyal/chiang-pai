import Link from "next/link";
import { ActivityFeed } from "@/components/activity";
import { MarketCard } from "@/components/market-card";
import { Pies } from "@/components/pies";
import { Starters } from "@/components/starters";
import { EmptyState } from "@/components/ui";
import {
  listMarkets,
  memberResults,
  membersOf,
  netOf,
  recentActivity,
  summarizeResults,
} from "@/lib/data";
import { lingoOf } from "@/lib/lingo";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { starters } from "@/lib/starters";
import { isoDay, placeOf } from "@/lib/trips";

export default async function TripHome({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const t = lingoOf(me.lingo);
  const { view } = await searchParams;
  const showSettled = view === "settled";

  const [{ open, resolved, forYou }, netC, results, activity, roster] = await Promise.all([
    listMarkets(tripId, me.id),
    netOf(tripId, me.id),
    memberResults(tripId, me.id),
    recentActivity(tripId, 10),
    membersOf(tripId),
  ]);

  const committedC = open.reduce((s, v) => s + v.myStakeC, 0);
  const committedCount = open.filter((v) => v.myStakeC > 0).length;
  const myStats = summarizeResults(results);
  const profitByMarket = new Map(results.map((r) => [r.market.id, r.profitC]));

  // The first few questions every trip argues about, offered until the table
  // has a few of its own.
  const drafts =
    open.length + resolved.length < 3
      ? starters({
          ...trip,
          place: placeOf(trip),
          members: roster.map((m) => ({ id: m.id, name: m.name })),
          viewerId: me.id,
          today: isoDay(new Date(), "Asia/Kolkata"),
        })
      : [];

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_270px]">
      <div>
        {/* What do I have, what's at stake, how am I doing */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile label="Net pies" value={<Pies c={netC} sign />} />
          <StatTile
            label="Open calls"
            value={<Pies c={committedC} />}
            sub={
              committedC > 0
                ? `across ${committedCount} prediction${committedCount === 1 ? "" : "s"}`
                : t.openBetsEmpty
            }
          />
          <StatTile
            label="Record"
            value={`${myStats.wins}–${myStats.losses}`}
            sub={
              myStats.resolvedCount > 0
                ? `${piesText(myStats.profitC, { sign: true })} on this trip`
                : "no verdicts yet"
            }
          />
        </div>

        {/* Ranked pitches: open predictions the viewer hasn't joined yet */}
        {!showSettled && forYou.length > 0 && (
          <section className="mt-7">
            <div className="flex items-baseline gap-3">
              <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
                {t.forYouHeading}
              </h2>
              <p className="text-xs text-soft">{t.forYouSub}</p>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {forYou.map((v) => (
                <MarketCard key={v.market.id} view={v} lingo={me.lingo} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div className="display flex items-end gap-4 text-2xl font-bold uppercase tracking-wide">
            <Link
              href={routes.trip(tripId)}
              className={showSettled ? "text-soft hover:text-ink" : "border-b-[3px] border-felt"}
            >
              Open predictions
            </Link>
            <Link
              href={routes.settled(tripId)}
              className={showSettled ? "border-b-[3px] border-felt" : "text-soft hover:text-ink"}
            >
              Resolved
            </Link>
          </div>
          <Link
            href={routes.newMarket(tripId)}
            className="display rounded-md bg-felt px-4 py-2 text-lg font-bold uppercase text-white hover:bg-felt-deep"
          >
            + New prediction
          </Link>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {(showSettled ? resolved : open).map((v) => (
            <MarketCard
              key={v.market.id}
              view={v}
              myProfitC={showSettled ? profitByMarket.get(v.market.id) : undefined}
              lingo={me.lingo}
            />
          ))}
        </div>

        {!showSettled && open.length === 0 && (
          <div className="mt-4">
            <EmptyState title={t.openEmptyTitle} sub={t.openEmptySub} />
          </div>
        )}
        {showSettled && resolved.length === 0 && (
          <p className="mt-4 text-sm text-soft">{t.resolvedEmpty}</p>
        )}

        {!showSettled && drafts.length > 0 && (
          <section className="mt-7">
            <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
              {t.startersHeading}
            </h2>
            <p className="text-xs text-soft">{t.startersSub}</p>
            <Starters tripId={tripId} drafts={drafts} />
          </section>
        )}
      </div>

      <aside>
        <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
          {t.activityHeading}
        </h2>
        <div className="mt-3">
          <ActivityFeed items={activity} showMarket lingo={me.lingo} />
        </div>
      </aside>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card px-3 py-2.5 sm:px-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">{label}</p>
      <p className="display mono mt-0.5 text-2xl font-extrabold sm:text-3xl">{value}</p>
      {sub && <p className="text-xs text-soft">{sub}</p>}
    </div>
  );
}
