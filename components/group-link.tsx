"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mintInviteAction, revokeInviteAction } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";
import { fmtDate } from "@/lib/format";

/**
 * One open door for the whole group: anyone holding it can join, as many times
 * as people click it, until it expires or a founder shuts it. Stronger than a
 * personal invite in every sense — hence the plain warning and the revoke
 * button sitting right next to it.
 */
export function GroupLink({
  existing,
}: {
  existing: { code: string; url: string; expiresAt: Date; useCount: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);

  const url = minted ?? existing?.url;

  const act = (run: () => Promise<{ ok: boolean; error?: string; url?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await run();
      if (!res.ok) {
        setError(res.error ?? "That didn't work.");
        return;
      }
      if (res.url) setMinted(res.url);
      router.refresh();
    });

  if (!existing && !minted) {
    return (
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => act(() => mintInviteAction("Anyone with the link", { isOpen: true }))}
          className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-40"
        >
          {pending ? "Minting…" : "Create a group link"}
        </button>
        {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface/60 px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
          {url}
        </code>
        {url && <CopyLink url={url} />}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-soft">
        <span>
          {existing
            ? `${existing.useCount} ${existing.useCount === 1 ? "person has" : "people have"} joined through it`
            : "Nobody has used it yet"}
        </span>
        {existing && <span>· expires {fmtDate(existing.expiresAt)}</span>}
        {existing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setMinted(null);
              act(() => revokeInviteAction(existing.code));
            }}
            className="font-semibold text-no-deep hover:underline disabled:opacity-40"
          >
            Shut it
          </button>
        )}
      </p>
      {error && <p className="mt-1 text-xs font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
