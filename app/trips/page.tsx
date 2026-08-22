import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/ui";
import { listTrips } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { lingoOf } from "@/lib/lingo";
import { routes } from "@/lib/routes";
import { requireMember } from "@/lib/session";
import { DESTINATIONS } from "@/lib/talk";
import { isoDay, tripPhase } from "@/lib/trips";

/**
 * Every trip the member is on. One trip is no choice, so a member with
 * exactly one lands on it — unless they asked for the list.
 */
export default async function TripsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const me = await requireMember();
  const t = lingoOf(me.lingo);
  const { all } = await searchParams;
  const trips = await listTrips(me.id);
  if (trips.length === 1 && all == null) redirect(routes.trip(trips[0].trip.id));
  const today = isoDay(new Date(), "Asia/Kolkata");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Your trips</p>
          <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
            {t.tripsTitle}
          </h1>
          <p className="mt-1 text-sm text-soft">{t.tripsSub}</p>
        </div>
        <Link
          href={routes.newTrip}
          className="display rounded-md bg-felt px-4 py-2 text-lg font-bold uppercase text-white hover:bg-felt-deep"
        >
          + New trip
        </Link>
      </div>

      {trips.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t.tripsEmptyTitle} sub={t.tripsEmptySub} />
        </div>
      ) : (
        <ul className="mt-6 grid gap-3">
          {trips.map(({ trip, role, memberCount, openCount }) => {
            const there = DESTINATIONS[trip.destination];
            const phase = tripPhase(trip, today);
            return (
              <li key={trip.id}>
                <Link
                  href={routes.trip(trip.id)}
                  className="card flex items-center gap-4 px-4 py-3 hover:border-felt"
                >
                  <span className="text-3xl" aria-hidden>
                    {there?.flag ?? "✈️"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="display block truncate text-2xl font-extrabold uppercase tracking-wide">
                      {trip.name}
                    </span>
                    <span className="block text-xs text-soft">
                      {there?.place ?? trip.destination}
                      {trip.startsOn && ` · ${fmtDate(trip.startsOn)}`}
                      {trip.endsOn && ` – ${fmtDate(trip.endsOn)}`}
                      {phase === "after" && " · home"}
                    </span>
                  </span>
                  <span className="text-right text-xs text-soft">
                    <span className="block">
                      {memberCount} {memberCount === 1 ? "person" : "people"}
                    </span>
                    <span className="block">
                      {openCount} open call{openCount === 1 ? "" : "s"}
                    </span>
                    {role === "organiser" && <span className="block text-gold">organiser</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
