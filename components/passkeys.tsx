"use client";

// The browser half of both passkey ceremonies. Everything that decides
// anything happens on the server (app/actions.ts → lib/webauthn.ts); this file
// only shuttles bytes between a server action and the authenticator, which is
// why it is mostly base64url plumbing.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
  removePasskeyAction,
} from "@/app/actions";
import { fmtDate, timeAgo } from "@/lib/format";

export function toBase64url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function fromBase64url(value: string): ArrayBuffer {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  // Built on an ArrayBuffer we own, so the result is a BufferSource the
  // credentials API accepts without a cast.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** What went wrong, in words a member can act on. */
export function ceremonyError(err: unknown, verb: string): string {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") return `Cancelled — nothing was ${verb}.`;
  if (name === "InvalidStateError") return "This device already has a passkey for Chiang Pai.";
  if (name === "SecurityError") {
    // Nearly always the rp id: an IP address, or a host that isn't a secure
    // context. The server checks for both, so reaching here means something
    // subtler — name it rather than shrugging.
    return `This site can't offer passkeys from this address (${err instanceof Error ? err.message : name}).`;
  }
  if (name === "NotSupportedError")
    return "This device can't make a passkey of the kind we asked for.";
  return name ? `That didn't work (${name}). Try again.` : "That didn't work. Try again.";
}

/** Run the registration ceremony end to end; returns an error message or null. */
async function enrolPasskey(): Promise<string | null> {
  if (!window.PublicKeyCredential) return "This browser doesn't support passkeys.";

  const begun = await beginPasskeyRegistrationAction();
  if (!begun.ok || !begun.options) return begun.error ?? "Couldn't start. Try again.";
  const options = begun.options;

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
        excludeCredentials: options.excludeCredentials.map((c) => ({
          type: c.type,
          id: fromBase64url(c.id),
        })),
        authenticatorSelection: options.authenticatorSelection,
        attestation: options.attestation,
        timeout: options.timeout,
      },
    })) as PublicKeyCredential | null;
  } catch (err) {
    return ceremonyError(err, "added");
  }
  if (!credential) return "No passkey was created.";

  const response = credential.response as AuthenticatorAttestationResponse;
  const saved = await finishPasskeyRegistrationAction({
    id: credential.id,
    clientDataJSON: toBase64url(response.clientDataJSON),
    attestationObject: toBase64url(response.attestationObject),
  });
  return saved.ok ? null : (saved.error ?? "That didn't work.");
}

export function AddPasskeyButton({
  className,
  label = "Add a passkey",
}: {
  className?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const failure = await enrolPasskey();
            if (failure) setError(failure);
            else router.refresh();
          })
        }
        className={
          className ??
          "rounded-md bg-felt px-3 py-2 text-sm font-semibold text-white hover:bg-felt-deep disabled:opacity-40"
        }
      >
        {pending ? "Waiting for your device…" : label}
      </button>
      {error && <span className="text-xs font-semibold text-no-deep">{error}</span>}
    </span>
  );
}

export interface PasskeySummary {
  id: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  backedUp: boolean;
}

/** Shown on your own member page: the keys that can sign in as you. */
export function PasskeyManager({ passkeys }: { passkeys: PasskeySummary[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div>
      {passkeys.length === 0 ? (
        <p className="text-sm text-soft">
          No passkeys yet. Adding one takes a tap — your device makes a key, and nothing about you
          is stored.
        </p>
      ) : (
        <ul className="card list">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {passkey.backedUp ? "Synced passkey" : "This device only"}
                </p>
                <p className="truncate text-xs text-soft">
                  Added {fmtDate(passkey.createdAt)}
                  {passkey.lastUsedAt
                    ? ` · last used ${timeAgo(passkey.lastUsedAt)}`
                    : " · not used yet"}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await removePasskeyAction(passkey.id);
                    router.refresh();
                  })
                }
                className="rounded-md px-2 py-1 text-xs text-soft hover:underline disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        <AddPasskeyButton label={passkeys.length === 0 ? "Add a passkey" : "Add another device"} />
      </div>
    </div>
  );
}
