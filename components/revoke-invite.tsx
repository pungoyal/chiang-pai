"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revokeInviteAction } from "@/app/actions";

/** Kill a link that hasn't been used — a misdirected invite shouldn't linger a week. */
export function RevokeInvite({ codeHash }: { codeHash: string }) {
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
            const res = await revokeInviteAction(codeHash);
            if (!res.ok) setError(res.error ?? "That didn't work.");
            else router.refresh();
          })
        }
        className="rounded-md px-2 py-1 text-xs text-soft hover:underline disabled:opacity-40"
      >
        Revoke
      </button>
      {error && <span className="text-xs font-semibold text-no-deep">{error}</span>}
    </span>
  );
}
