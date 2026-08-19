"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { mintInviteAction } from "@/app/actions";
import { CopyLink } from "@/components/copy-link";

/** Mint a personal link rather than name an address. It shows up in the pending list too. */
export function InviteForm({ baseUrl }: { baseUrl: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [label, setLabel] = useState("");
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mint = () =>
    startTransition(async () => {
      setError(null);
      const res = await mintInviteAction(label);
      if (!res.ok || !res.code) {
        setError(res.error ?? "Couldn't mint an invite.");
        return;
      }
      setLink({ who: label.trim(), url: `${baseUrl}/join/${res.code}` });
      setLabel("");
      router.refresh();
    });

  return (
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Who are you inviting?"
          className="min-w-0 flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={pending || !label.trim()}
          onClick={mint}
          className="rounded-md bg-felt px-4 py-2 text-sm font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
        >
          {pending ? "Minting…" : "Mint link"}
        </button>
      </div>

      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}

      {link && (
        <div className="mt-3 rounded-md border border-gold/40 bg-gold/10 px-3 py-2">
          <p className="text-sm font-semibold">
            Send this to {link.who}. It works once, for seven days.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="mono min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 text-xs">
              {link.url}
            </code>
            <CopyLink url={link.url} />
          </div>
        </div>
      )}
    </div>
  );
}
