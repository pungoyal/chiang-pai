"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setFounderAction } from "@/app/actions";

/**
 * Who founds, as a thing founders hand to each other. It used to be an address
 * in FOUNDING_MEMBERS, which meant a member who joined by link — and so has no
 * address at all — could never be one. Now it is a column, and this is how it
 * moves. Stepping yourself down is allowed; stepping the last founder down is
 * not (lib/data.ts).
 */
export function FounderToggle({
  memberId,
  memberName,
  isFounder,
  isMe,
}: {
  memberId: string;
  memberName: string;
  isFounder: boolean;
  isMe: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const who = isMe ? "You" : memberName;
  const toggle = () =>
    startTransition(async () => {
      setError(null);
      const res = await setFounderAction(memberId, !isFounder);
      if (!res.ok) setError(res.error ?? "That didn't work.");
      else router.refresh();
    });

  return (
    <div className="card px-4 py-3">
      <p className="text-sm">
        {isFounder
          ? `${who} can invite people, shut links, and mint a recovery link for anyone at the table.`
          : `${who} can't invite anyone — only founding members can.`}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className="mt-2 rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-40"
      >
        {pending
          ? "Saving…"
          : isFounder
            ? isMe
              ? "Step down"
              : `Step ${memberName} down`
            : `Make ${isMe ? "myself" : memberName} a founder`}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
