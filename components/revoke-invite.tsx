"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { revokeInviteAction } from "@/app/actions";

/** Kill a link that hasn't been used — a misdirected invite shouldn't linger a week. */
export function RevokeInvite({ codeHash }: { codeHash: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await revokeInviteAction(codeHash);
          router.refresh();
        })
      }
      className="rounded-md px-2 py-1 text-xs text-soft hover:underline disabled:opacity-40"
    >
      Revoke
    </button>
  );
}
