import { notFound } from "next/navigation";
import { TripForm } from "@/components/trip-form";
import { isOrganiser } from "@/lib/data";
import { requireTrip } from "@/lib/session";
import { currencyName, placeOf, tripCurrencies } from "@/lib/trips";

export default async function TripSettingsPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  const ctx = await requireTrip(tripId);
  if (!isOrganiser(ctx)) notFound();
  const { trip } = ctx;
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Trip settings</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{trip.name}</h1>
      <p className="mt-1 text-sm text-soft">
        {placeOf(trip)} · {tripCurrencies(trip).map(currencyName).join(" and ")}. Where a trip goes
        and what it spends are set when it opens; the rest can change.
      </p>
      <div className="mt-5">
        <TripForm initial={trip} />
      </div>
    </div>
  );
}
