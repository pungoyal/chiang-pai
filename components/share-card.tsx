"use client";

import { useState } from "react";
import { routes } from "@/lib/routes";

/**
 * The one thing a resolved prediction wants to do next: land in the group
 * chat. The card page is public by URL (an unguessable id, first names and
 * pies only), so WhatsApp unfurls it with the verdict on the image. Uses the
 * share sheet where the phone has one, and copies the link where it doesn't.
 */
export function ShareCard({
  marketId,
  question,
  tripName,
}: {
  marketId: string;
  question: string;
  tripName: string;
}) {
  const [done, setDone] = useState<string | null>(null);
  const share = async () => {
    const url = `${window.location.origin}${routes.card(marketId)}`;
    const text = `${question}\n— called on ${tripName}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: tripName, text, url });
        setDone("Shared.");
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setDone("Link copied — paste it in the group.");
    } catch {
      // Cancelled, or no clipboard: nothing to say.
    }
  };
  const wa = `https://wa.me/?text=${encodeURIComponent(`${question}\n— called on ${tripName}\n`)}`;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <button
        type="button"
        onClick={share}
        className="rounded-md bg-felt px-3 py-1.5 text-sm font-semibold text-white hover:bg-felt-deep"
      >
        Share the verdict
      </button>
      <a
        href={`${wa}${encodeURIComponent(routes.card(marketId))}`}
        data-card={marketId}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-line px-3 py-1.5 text-sm font-semibold hover:bg-paper"
        onClick={(e) => {
          // The absolute URL is only known in the browser.
          e.currentTarget.href = `${wa}${encodeURIComponent(`${window.location.origin}${routes.card(marketId)}`)}`;
        }}
      >
        WhatsApp
      </a>
      {done && <span className="text-xs text-soft">{done}</span>}
    </div>
  );
}
