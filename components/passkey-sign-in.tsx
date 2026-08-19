"use client";

import { useState, useTransition } from "react";
import { beginPasskeySignInAction, finishPasskeySignInAction } from "@/app/actions";
import { assertCredential, usePreparedCeremony } from "@/components/passkeys";

/**
 * One button, no field to type in: the challenge carries no credential list, so
 * the browser offers whichever passkey it holds for this site and the signature
 * decides who you are. On success the server action redirects home.
 */
export function PasskeySignIn() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Signing in is the whole purpose of this page, so the challenge is ready
  // before the button is pressed — Safari needs the gesture spent on the
  // authenticator, not on a round trip.
  const ceremony = usePreparedCeremony(beginPasskeySignInAction, { when: "mount" });

  const signIn = () => {
    const ready = ceremony.take();
    ceremony.spend();
    startTransition(async () => {
      setError(null);
      const asserted = await assertCredential(ready ?? (await beginPasskeySignInAction()));
      if ("error" in asserted) {
        setError(asserted.error);
        return;
      }
      // Success redirects, so anything returned here is a refusal.
      const result = await finishPasskeySignInAction(asserted.wire);
      setError(result.error ?? "That passkey didn't work.");
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="block w-full rounded-md bg-felt py-3 font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
      >
        {pending ? "Waiting for your device…" : "Sign in with a passkey"}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
    </div>
  );
}
