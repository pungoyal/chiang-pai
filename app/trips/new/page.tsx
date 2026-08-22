import { TripForm } from "@/components/trip-form";
import { lingoOf } from "@/lib/lingo";
import { requireMember } from "@/lib/session";

export default async function NewTripPage() {
  const me = await requireMember();
  const t = lingoOf(me.lingo);
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">New trip</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.newTripTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.newTripSub}</p>
      <div className="mt-5">
        <TripForm />
      </div>
    </div>
  );
}
