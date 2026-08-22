"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setRoleAction } from "@/app/actions";

/**
 * Who organises, as a thing organisers hand to each other on a trip. Stepping
 * yourself down is allowed; stepping the last organiser down is not
 * (lib/data.ts setRole).
 */
export function OrganiserToggle({
  tripId,
  memberId,
  memberName,
  isOrganiser,
  isMe,
}: {
  tripId: string;
  memberId: string;
  memberName: string;
  isOrganiser: boolean;
  isMe: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const who = isMe ? "You" : memberName;
  const toggle = () =>
    startTransition(async () => {
      setError(null);
      const res = await setRoleAction(tripId, memberId, isOrganiser ? "member" : "organiser");
      if (!res.ok) setError(res.error ?? "That didn't work.");
      else router.refresh();
    });

  return (
    <div className="card px-4 py-3">
      <p className="text-sm">
        {isOrganiser
          ? `${who} can invite people, shut links, reopen a wrong verdict, and mint a recovery link for anyone on this trip.`
          : `${who} can't invite anyone to this trip — only organisers can.`}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={toggle}
        className="mt-2 rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-40"
      >
        {pending
          ? "Saving…"
          : isOrganiser
            ? isMe
              ? "Step down"
              : `Step ${memberName} down`
            : `Make ${isMe ? "myself" : memberName} an organiser`}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
