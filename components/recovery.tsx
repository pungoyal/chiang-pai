"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mintRecoveryAction, revokeRecoveryAction } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";
import { timeUntil } from "@/lib/format";

/** Shut a live link: any organiser of the trip, or the member whose seat it opens. */
export function ShutRecovery({
  tripId,
  code,
  label = "Shut it",
}: {
  tripId: string;
  code: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await revokeRecoveryAction(tripId, code);
            if (!res.ok) setError(res.error ?? "That didn't work.");
            else router.refresh();
          })
        }
        className="rounded-md px-2 py-1 text-xs font-semibold text-no-deep hover:underline disabled:opacity-40"
      >
        {label}
      </button>
      {error && <span className="text-xs font-semibold text-no-deep">{error}</span>}
    </span>
  );
}

/**
 * The organiser's half of a recovery, on the member's own page: mint a link that
 * puts a new passkey on this seat, and hand it over however you just confirmed
 * it was really them asking. Minting a second one shuts the first, so what is
 * shown here is the only live link there is.
 */
export function RecoveryPanel({
  tripId,
  memberId,
  memberName,
  live,
}: {
  tripId: string;
  memberId: string;
  memberName: string;
  live: { code: string; url: string; expiresAt: Date } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Nothing is held in state: minting shuts whatever came before it, so the
  // one live link is whatever the server just told us about. The transition
  // stays pending until the refresh lands, which is what shows it.
  const mint = () =>
    startTransition(async () => {
      setError(null);
      const res = await mintRecoveryAction(tripId, memberId);
      if (!res.ok) {
        setError(res.error ?? "Couldn't mint a recovery link.");
        return;
      }
      router.refresh();
    });

  return (
    <div className="card border-gold/40 bg-gold/10 px-4 py-3">
      <p className="font-semibold">Lost every passkey?</p>
      <p className="mt-0.5 text-xs text-soft">
        A recovery link puts a new passkey on {memberName}'s seat. Whoever opens it becomes{" "}
        {memberName} — so mint one only when you know, by voice and not by message, that it is
        really them asking. It lasts half an hour, works once, and the whole table can see it while
        it is live.
      </p>

      {live ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
              {live.url}
            </code>
            <CopyLink url={live.url} />
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-soft">
            <span>expires {timeUntil(live.expiresAt)}</span>
            <ShutRecovery tripId={tripId} code={live.code} />
            <button
              type="button"
              disabled={pending}
              onClick={mint}
              className="font-semibold hover:underline disabled:opacity-40"
            >
              {pending ? "Minting…" : "Mint a fresh one"}
            </button>
          </p>
        </div>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={mint}
          className="mt-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-semibold hover:bg-paper disabled:opacity-40"
        >
          {pending ? "Minting…" : "Mint a recovery link"}
        </button>
      )}
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
