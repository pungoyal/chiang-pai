"use client";

import { useState, useTransition } from "react";
import { beginPasskeySignInAction, finishPasskeySignInAction } from "@/app/actions";
import { ceremonyError, fromBase64url, toBase64url } from "@/components/passkeys";

/**
 * One button, no field to type in: the challenge carries no credential list, so
 * the browser offers whichever passkey it holds for this site and the signature
 * decides who you are. On success the server action redirects home.
 */
export function PasskeySignIn() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const signIn = () =>
    startTransition(async () => {
      setError(null);
      if (!window.PublicKeyCredential) {
        setError("This browser doesn't support passkeys.");
        return;
      }

      const begun = await beginPasskeySignInAction();
      if (!begun.ok || !begun.options) {
        setError(begun.error ?? "Couldn't start. Try again.");
        return;
      }
      const options = begun.options;

      let credential: PublicKeyCredential | null;
      try {
        credential = (await navigator.credentials.get({
          publicKey: {
            challenge: fromBase64url(options.challenge),
            rpId: options.rpId,
            userVerification: options.userVerification,
            timeout: options.timeout,
          },
        })) as PublicKeyCredential | null;
      } catch (err) {
        setError(ceremonyError(err, "signed in"));
        return;
      }
      if (!credential) {
        setError("No passkey was offered.");
        return;
      }

      const response = credential.response as AuthenticatorAssertionResponse;
      const result = await finishPasskeySignInAction({
        id: credential.id,
        clientDataJSON: toBase64url(response.clientDataJSON),
        authenticatorData: toBase64url(response.authenticatorData),
        signature: toBase64url(response.signature),
      });
      // Success redirects, so anything returned here is a refusal.
      setError(result.error ?? "That passkey didn't work.");
    });

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
