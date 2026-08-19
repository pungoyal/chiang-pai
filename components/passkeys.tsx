"use client";

// The browser half of both passkey ceremonies. Everything that decides
// anything happens on the server (app/actions.ts → lib/webauthn.ts); this file
// only shuttles bytes between a server action and the authenticator, which is
// why it is mostly base64url plumbing.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions";
import {
  beginPasskeyRegistrationAction,
  finishPasskeyRegistrationAction,
  removePasskeyAction,
} from "@/app/actions";
import { fmtDate, timeAgo } from "@/lib/format";
import type { PasskeyRegistrationOptions, PasskeySignInOptions } from "@/lib/webauthn";

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

/**
 * A passkey is bound to the rp id the server derives from AUTH_URL, and the
 * browser refuses outright if the page it is on doesn't match. That refusal is
 * a bare SecurityError, so check it here instead and name both addresses —
 * reaching this app on 127.0.0.1 when AUTH_URL says localhost is the easiest
 * way to hit it, and the least obvious to diagnose.
 */
export function originMismatch(expected: string): string | null {
  if (window.location.origin === expected) return null;
  return `This page is ${window.location.origin}, but passkeys are set up for ${expected}. Open the app there instead.`;
}

/** What went wrong, in words a member can act on. */
export function ceremonyError(err: unknown, verb: string): string {
  // The browser's own reason is worth keeping: these failures are rare enough
  // that a name in the console beats a friendly message with nothing behind it.
  console.error("passkey ceremony failed", err);
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError") {
    return `Cancelled or timed out — nothing was ${verb}. If no prompt appeared, your passkey manager may be locked.`;
  }
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

/** The wire shape a finish action expects; see lib/webauthn.ts. */
export interface RegistrationWire {
  id: string;
  clientDataJSON: string;
  attestationObject: string;
}

export type Begun<T> = ActionResult & { options?: T };

/**
 * Ceremony options, fetched *before* the click that needs them.
 *
 * Safari will only run `navigator.credentials.*` on a live user gesture, and
 * awaiting a server round trip inside the click handler spends it — the call
 * then fails with a bare NotAllowedError that reads as "the member cancelled".
 * So the round trip happens ahead of time and `take()` is synchronous.
 *
 * `when: "mount"` for a page whose whole purpose is the ceremony; `"intent"`
 * for a button that rides along on every page, where a challenge per page view
 * would be waste. A challenge is single use and lasts five minutes, so a stale
 * one is refreshed rather than reused.
 */
export function usePreparedCeremony<T>(
  begin: () => Promise<Begun<T>>,
  { when, ready = true, key = "" }: { when: "mount" | "intent"; ready?: boolean; key?: string },
) {
  const latest = useRef(begin);
  latest.current = begin;
  const [prepared, setPrepared] = useState<Begun<T> | null>(null);
  const [round, setRound] = useState(0);

  const fetchNow = useCallback(() => {
    let cancelled = false;
    latest.current().then(
      (result) => {
        if (!cancelled) setPrepared(result);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // `key` and `round` are re-run triggers rather than values the effect reads:
  // a changed key (the name being typed) invalidates the prepared challenge,
  // and a bumped round asks for a fresh one after the last was spent.
  // biome-ignore lint/correctness/useExhaustiveDependencies: triggers, not reads
  useEffect(() => {
    if (when !== "mount" || !ready) return;
    // A short pause so a name being typed doesn't mint a challenge per keystroke.
    const timer = setTimeout(fetchNow, 250);
    return () => clearTimeout(timer);
  }, [when, ready, key, round, fetchNow]);

  return {
    /** Warm the options on hover or touch, before the click arrives. */
    prepare: () => {
      if (when === "intent" && ready && !prepared) fetchNow();
    },
    /** Synchronous on purpose: awaiting here is the bug this exists to avoid. */
    take: (): Begun<T> | null => prepared,
    /** After an attempt: the challenge is spent either way, so get another. */
    spend: () => {
      setPrepared(null);
      setRound((r) => r + 1);
    },
  };
}

/**
 * The registration ceremony: turn options the server already handed us into a
 * credential. Adding a passkey and joining by invite differ only in which
 * actions they call, so they differ only in what they pass here.
 *
 * Takes the options rather than a way to fetch them, so that the first thing
 * this does on the fast path is call the authenticator, with the click's
 * activation still live.
 */
export async function createCredential(
  begun: Begun<PasskeyRegistrationOptions>,
  verb: string,
): Promise<{ wire: RegistrationWire } | { error: string }> {
  if (!window.PublicKeyCredential) return { error: "This browser doesn't support passkeys." };
  if (!begun.ok || !begun.options) return { error: begun.error ?? "Couldn't start. Try again." };
  const options = begun.options;
  const mismatch = originMismatch(options.origin);
  if (mismatch) return { error: mismatch };

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
    return { error: ceremonyError(err, verb) };
  }
  if (!credential) return { error: `No passkey was ${verb}.` };

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    wire: {
      id: credential.id,
      clientDataJSON: toBase64url(response.clientDataJSON),
      attestationObject: toBase64url(response.attestationObject),
    },
  };
}

/** The wire shape the sign-in finish action expects. */
export interface AssertionWire {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/**
 * The sign-in ceremony, the mirror of createCredential: options in, a signed
 * assertion out. Same reason for taking the options rather than fetching them.
 */
export async function assertCredential(
  begun: Begun<PasskeySignInOptions>,
): Promise<{ wire: AssertionWire } | { error: string }> {
  if (!window.PublicKeyCredential) return { error: "This browser doesn't support passkeys." };
  if (!begun.ok || !begun.options) return { error: begun.error ?? "Couldn't start. Try again." };
  const options = begun.options;
  const mismatch = originMismatch(options.origin);
  if (mismatch) return { error: mismatch };

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
    return { error: ceremonyError(err, "signed in") };
  }
  if (!credential) return { error: "No passkey was offered." };

  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    wire: {
      id: credential.id,
      clientDataJSON: toBase64url(response.clientDataJSON),
      authenticatorData: toBase64url(response.authenticatorData),
      signature: toBase64url(response.signature),
    },
  };
}

export function AddPasskeyButton({
  className,
  label = "Add a passkey",
  prepareOn = "mount",
}: {
  className?: string;
  label?: string;
  /** "intent" for the banner that rides along on every page; see usePreparedCeremony. */
  prepareOn?: "mount" | "intent";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ceremony = usePreparedCeremony(beginPasskeyRegistrationAction, { when: prepareOn });

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onPointerEnter={ceremony.prepare}
        onTouchStart={ceremony.prepare}
        onFocus={ceremony.prepare}
        onClick={() => {
          // Read the options before the transition, so the authenticator call
          // below is the first thing that happens on this gesture.
          const ready = ceremony.take();
          ceremony.spend();
          startTransition(async () => {
            setError(null);
            const made = await createCredential(
              ready ?? (await beginPasskeyRegistrationAction()),
              "added",
            );
            if ("error" in made) {
              setError(made.error);
              return;
            }
            const saved = await finishPasskeyRegistrationAction(made.wire);
            if (!saved.ok) setError(saved.error ?? "That didn't work.");
            else router.refresh();
          });
        }}
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
  const [error, setError] = useState<string | null>(null);

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
                    setError(null);
                    const res = await removePasskeyAction(passkey.id);
                    if (!res.ok) setError(res.error ?? "That didn't work.");
                    else router.refresh();
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
      {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      <div className="mt-3">
        <AddPasskeyButton label={passkeys.length === 0 ? "Add a passkey" : "Add another device"} />
      </div>
    </div>
  );
}
