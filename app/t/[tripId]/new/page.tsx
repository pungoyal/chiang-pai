import { NewMarketForm } from "@/components/new-market-form";
import { lingoOf } from "@/lib/lingo";
import { llmEnabled } from "@/lib/llm";
import { requireTrip } from "@/lib/session";

export default async function NewMarketPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ q?: string; c?: string }>;
}) {
  const { tripId } = await params;
  const { me, trip } = await requireTrip(tripId);
  const { q, c } = await searchParams;
  const t = lingoOf(me.lingo);
  const initial = q && c ? { question: q.slice(0, 200), criteria: c.slice(0, 2000) } : undefined;
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">New prediction</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.newTitle}</h1>
      <p className="mt-1 text-sm text-soft">
        One binary question. Say exactly how you'll decide YES or NO — you're the one who resolves
        it, and the criteria go on the permanent record. Everyone can put up to {trip.maxStakePies}{" "}
        pies on either side.
      </p>
      <div className="mt-5">
        <NewMarketForm
          tripId={tripId}
          polishAvailable={llmEnabled}
          lingo={me.lingo}
          initial={initial}
        />
      </div>
    </div>
  );
}
