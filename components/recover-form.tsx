"use client";

import { useState, useTransition } from "react";
import { beginRecoveryAction, finishRecoveryAction } from "@/app/actions";
import { createCredential, usePreparedCeremony } from "@/components/passkeys";

/**
 * The whole of coming back: make a new passkey, and it is added to the seat the
 * link names. No name to pick and nothing to choose — this member already
 * exists, and everything about them stays exactly as they left it.
 */
export function RecoverForm({ code, name }: { code: string; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const ceremony = usePreparedCeremony(() => beginRecoveryAction(code), { when: "mount" });

  const recover = () => {
    const ready = ceremony.take();
    ceremony.spend();
    startTransition(async () => {
      setError(null);
      const made = await createCredential(ready ?? (await beginRecoveryAction(code)), "added");
      if ("error" in made) {
        setError(made.error);
        return;
      }
      // Success redirects to the member's own page, so anything returned here
      // is a refusal.
      const result = await finishRecoveryAction({ code, response: made.wire });
      setError(result.error ?? "That didn't work.");
    });
  };

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={recover}
        disabled={pending}
        className="block w-full rounded-md bg-felt py-3 font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
      >
        {pending ? "Waiting for your device…" : `Add a new passkey for ${name}`}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      <p className="mt-3 text-left text-xs text-soft">
        Any passkeys {name} still holds keep working — this adds one, it never takes one away. The
        old ones are on {name}'s own page, to remove once you're back in.
      </p>
    </div>
  );
}
