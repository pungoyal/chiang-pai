"use client";

import { useState, useTransition } from "react";
import { joinAsMemberAction } from "@/app/actions";

/** A member of one trip holding a link to another: one tap and they're seated. */
export function JoinAsMember({
  code,
  name,
  tripName,
}: {
  code: string;
  name: string;
  tripName: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mt-5">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await joinAsMemberAction(code);
            if (r && !r.ok) setError(r.error ?? "That didn't work.");
          })
        }
        className="block w-full rounded-md bg-felt py-3 font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
      >
        {pending ? "Taking a seat…" : `Join ${tripName} as ${name}`}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
