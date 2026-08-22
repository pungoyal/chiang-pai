import Link from "next/link";
import { routes } from "@/lib/routes";
import type { StarterDraft } from "@/lib/starters";

/**
 * The questions every trip argues about, one tap from being on the record.
 * Plain links into the new-prediction form with the draft filled in, so the
 * member still reads and owns what they publish.
 */
export function Starters({ tripId, drafts }: { tripId: string; drafts: StarterDraft[] }) {
  return (
    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
      {drafts.map((d) => (
        <li key={d.key}>
          <Link
            href={`${routes.newMarket(tripId)}?q=${encodeURIComponent(d.question)}&c=${encodeURIComponent(d.criteria)}`}
            className="card block px-4 py-3 hover:border-felt"
          >
            <p className="font-semibold">{d.question}</p>
            <p className="mt-1 line-clamp-2 text-xs text-soft">{d.criteria}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
