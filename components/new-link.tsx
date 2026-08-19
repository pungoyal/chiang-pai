"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { replaceInviteAction } from "@/app/actions";

/**
 * For invites minted before codes were stored, where there is nothing left to
 * copy. Swaps in a fresh link with the same label; the row then shows a copy
 * button like any other. The old link stops working, which is worth saying out
 * loud since it may already have been sent.
 */
export function NewLink({ codeHash }: { codeHash: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        disabled={pending}
        title="This invite predates copyable links — mint a fresh one. The old link stops working."
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const res = await replaceInviteAction(codeHash);
            if (!res.ok) setError(res.error ?? "That didn't work.");
            else router.refresh();
          })
        }
        className="rounded-md px-2 py-1 text-xs font-semibold text-soft hover:bg-surface disabled:opacity-40"
      >
        {pending ? "Minting…" : "New link"}
      </button>
      {error && <span className="text-xs font-semibold text-no-deep">{error}</span>}
    </span>
  );
}
