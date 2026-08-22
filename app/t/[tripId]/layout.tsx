import Link from "next/link";
import { Pies } from "@/components/pies";
import { TripNav } from "@/components/trip-nav";
import { inbox, netOf } from "@/lib/data";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { DESTINATIONS, pairFor } from "@/lib/talk";
import { daysBetween, isoDay, tripPhase } from "@/lib/trips";

/**
 * Everything under /t/[tripId] sits inside this: the trip's name and where it
 * is in its life, the tabs, and the viewer's number on this trip. A member
 * with no seat is sent to their trips list by requireTrip before any of it.
 */
export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const [netC, { unreadCount }] = await Promise.all([
    netOf(tripId, me.id),
    inbox(tripId, me.id, 1),
  ]);
  const pair = pairFor(trip);
  const there = DESTINATIONS[trip.destination];
  const today = isoDay(new Date(), "Asia/Kolkata");
  const phase = tripPhase(trip, today);

  let when: string | null = null;
  if (phase === "before" && trip.startsOn) {
    const d = daysBetween(today, trip.startsOn);
    when = d === 0 ? "Leaving today" : d === 1 ? "Leaving tomorrow" : `In ${d} days`;
  } else if (phase === "during" && trip.endsOn) {
    const left = daysBetween(today, trip.endsOn);
    when = left === 0 ? "Last day" : `${left} day${left === 1 ? "" : "s"} left`;
  } else if (phase === "after") {
    when = "Home";
  }

  return (
    <div>
      <div className="-mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="eyebrow">
            {there?.flag} {there?.place ?? trip.destination}
            {when && <span className="text-soft"> · {when}</span>}
          </p>
          <h1 className="display truncate text-3xl font-extrabold uppercase tracking-wide sm:text-4xl">
            <Link href={routes.trip(tripId)}>{trip.name}</Link>
          </h1>
        </div>
        <Link
          href={routes.member(tripId, me.id)}
          className="mono rounded-full bg-felt-tint px-3 py-1 text-sm font-semibold text-felt"
          title="Your pies on this trip"
        >
          <Pies c={netC} sign />
        </Link>
      </div>
      <TripNav
        tripId={tripId}
        unread={unreadCount > 0}
        talkLabel={pair ? pair.them.language : null}
        ended={phase === "after"}
      />
      <div className="mt-5">{children}</div>
    </div>
  );
}
