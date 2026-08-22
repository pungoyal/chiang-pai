import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { Pies } from "@/components/pies";
import { marketCard } from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import { DESTINATIONS } from "@/lib/talk";

/**
 * The public face of one prediction: what a member drops in the group chat.
 * Reachable by URL alone — an unguessable id — and deliberately thin: the
 * question, the verdict, first names and pies. Nothing about the trip beyond
 * its name, and a way in for whoever was shown it. This page is the app's
 * only advertisement, and it is written by the people playing.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ marketId: string }>;
}): Promise<Metadata> {
  const { marketId } = await params;
  const card = await marketCard(marketId);
  if (!card) return { title: "Chiang Pai" };
  const verdict =
    card.status === "open"
      ? "Still open"
      : card.status === "refunded"
        ? "Voided"
        : card.status.toUpperCase();
  return {
    title: card.question,
    description: `${verdict} · ${card.trip.name} · Chiang Pai`,
    openGraph: { title: card.question, description: `${verdict} on ${card.trip.name}` },
  };
}

export default async function CardPage({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const [card, me] = await Promise.all([marketCard(marketId), currentMember()]);
  if (!card) notFound();
  const there = DESTINATIONS[card.trip.destination];
  const settled = card.status === "yes" || card.status === "no";

  return (
    <div className="mx-auto max-w-md">
      <div className="card overflow-hidden">
        <div className="bg-felt-deep px-5 py-4 text-[#f1eee4]">
          <p className="text-xs uppercase tracking-wider text-white/60">
            {there?.flag} {card.trip.name}
            {card.resolvedAt && ` · ${fmtDate(card.resolvedAt)}`}
          </p>
          <p className="display mt-1 text-3xl font-extrabold leading-tight">{card.question}</p>
        </div>
        <div className="px-5 py-4">
          <p className="display text-xl font-bold uppercase tracking-wide">
            {card.status === "open" && "Still open"}
            {card.status === "refunded" && "Voided — everyone got their pies back"}
            {settled && (
              <>
                Resolved{" "}
                <span className={card.status === "yes" ? "text-yes-deep" : "text-no-deep"}>
                  {card.status.toUpperCase()}
                </span>
              </>
            )}
          </p>
          {settled && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                  Called it
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {card.winners.map((w) => (
                    <li key={w.name} className="flex justify-between">
                      <span className="font-semibold">{w.name}</span>
                      <span className="mono text-felt">
                        <Pies c={w.profitC} sign />
                      </span>
                    </li>
                  ))}
                  {card.winners.length === 0 && <li className="text-soft">nobody</li>}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                  Paid for it
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {card.losers.map((l) => (
                    <li key={l.name} className="flex justify-between">
                      <span className="font-semibold">{l.name}</span>
                      <span className="mono text-no-deep">
                        <Pies c={l.profitC} sign />
                      </span>
                    </li>
                  ))}
                  {card.losers.length === 0 && <li className="text-soft">nobody</li>}
                </ul>
              </div>
            </div>
          )}
          {card.poolC > 0 && (
            <p className="mono mt-3 text-xs text-soft">
              <Pies c={card.poolC} /> in the pool · pies are play money, always
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <Logo size={40} className="rounded-xl" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold">Chiang Pai — the app for the trip that actually happens.</p>
          <p className="text-xs text-soft">
            Call who shows up, who's late, who pays. Free, no money, ever.
          </p>
        </div>
        <Link
          href={me ? routes.trips : routes.home}
          className="rounded-md bg-felt px-3 py-2 text-sm font-semibold text-white hover:bg-felt-deep"
        >
          {me ? "Your trips" : "Start yours"}
        </Link>
      </div>
    </div>
  );
}
