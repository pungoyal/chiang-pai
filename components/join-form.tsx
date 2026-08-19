"use client";

import { useState, useTransition } from "react";
import { beginJoinAction, finishJoinAction } from "@/app/actions";
import { ceremonyError, fromBase64url, originMismatch, toBase64url } from "@/components/passkeys";

/**
 * Everything a new member does: pick a name, make a passkey. No address, no
 * password, no account anywhere else. The server action redirects home once the
 * signature checks out and the link is spent.
 */
export function JoinForm({ code, label }: { code: string; label: string }) {
  const [name, setName] = useState(label);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const join = () =>
    startTransition(async () => {
      setError(null);
      if (!window.PublicKeyCredential) {
        setError("This browser doesn't support passkeys.");
        return;
      }

      const begun = await beginJoinAction(code, name);
      if (!begun.ok || !begun.options) {
        setError(begun.error ?? "Couldn't start. Try again.");
        return;
      }
      const options = begun.options;
      const mismatch = originMismatch(options.origin);
      if (mismatch) {
        setError(mismatch);
        return;
      }

      let credential: PublicKeyCredential | null;
      try {
        credential = (await navigator.credentials.create({
          publicKey: {
            challenge: fromBase64url(options.challenge),
            rp: options.rp,
            user: {
              id: fromBase64url(options.user.id),
              name: options.user.name,
              displayName: options.user.displayName,
            },
            pubKeyCredParams: options.pubKeyCredParams,
            authenticatorSelection: options.authenticatorSelection,
            attestation: options.attestation,
            timeout: options.timeout,
          },
        })) as PublicKeyCredential | null;
      } catch (err) {
        setError(ceremonyError(err, "created"));
        return;
      }
      if (!credential) {
        setError("No passkey was created.");
        return;
      }

      const response = credential.response as AuthenticatorAttestationResponse;
      const result = await finishJoinAction({
        code,
        name,
        response: {
          id: credential.id,
          clientDataJSON: toBase64url(response.clientDataJSON),
          attestationObject: toBase64url(response.attestationObject),
        },
      });
      // Success redirects, so anything returned here is a refusal.
      setError(result.error ?? "That didn't work.");
    });

  return (
    <div className="mt-6 text-left">
      <label
        htmlFor="join-name"
        className="text-xs font-semibold uppercase tracking-wider text-soft"
      >
        What should the table call you?
      </label>
      <input
        id="join-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={40}
        placeholder="Your name"
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={join}
        disabled={pending || name.trim().length < 2}
        className="mt-3 block w-full rounded-md bg-felt py-3 font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
      >
        {pending ? "Waiting for your device…" : "Create my passkey"}
      </button>
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      <p className="mt-3 text-xs text-soft">
        Your device makes a key and keeps it. We store its public half, your name, and nothing else
        — no email, no password.
      </p>
    </div>
  );
}
