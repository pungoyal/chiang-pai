"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reopenAction } from "@/app/actions";

/**
 * An organiser taking a resolution back. Resolving is the creator's call and says
 * "final" on the button, which is the point — so undoing one is deliberately
 * somebody else's job and asks twice before it moves anybody's pies.
 */
export function ReopenPanel({ marketId }: { marketId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reopen = () =>
    startTransition(async () => {
      setError(null);
      const res = await reopenAction(marketId);
      if (!res.ok) {
        setError(res.error ?? "That didn't work.");
        setConfirming(false);
      } else {
        router.refresh();
      }
    });

  return (
    <div className="mt-3 border-t border-line pt-3">
      {!confirming ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(true)}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold hover:bg-paper disabled:opacity-40"
        >
          Reopen this prediction
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="w-full text-xs text-soft">
            Everyone hands the pool back and the calls stand as they were. It can be resolved again.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={reopen}
            className="rounded-md bg-felt px-3 py-1.5 text-xs font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
          >
            {pending ? "Reopening…" : "Yes, reopen it"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
            className="rounded-md px-3 py-1.5 text-xs font-semibold text-soft hover:underline disabled:opacity-40"
          >
            Back
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
