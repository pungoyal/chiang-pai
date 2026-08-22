"use client";

import { useState } from "react";

/**
 * The table as text, for the group chat. No link this time — a recap is the
 * trip's own, and the names on it are enough of an invitation.
 */
export function ShareRecap({
  tripName,
  lines,
  verdicts,
}: {
  tripName: string;
  lines: string[];
  verdicts: number;
}) {
  const [done, setDone] = useState<string | null>(null);
  const text = [
    `${tripName} — who could actually predict things`,
    ...lines,
    `${verdicts} verdicts, play-money pies, all bragging rights. π Chiang Pai`,
  ].join("\n");
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: tripName, text });
        setDone("Shared.");
        return;
      }
      await navigator.clipboard.writeText(text);
      setDone("Copied — paste it in the group.");
    } catch {
      // Cancelled: nothing to say.
    }
  };
  return (
    <div className="mt-7 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={share}
        className="display rounded-md bg-felt px-4 py-2 text-lg font-bold uppercase text-white hover:bg-felt-deep"
      >
        Share the table
      </button>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(text)}`}
        target="_blank"
        rel="noreferrer"
        className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-paper"
      >
        WhatsApp
      </a>
      {done && <span className="text-xs text-soft">{done}</span>}
    </div>
  );
}
