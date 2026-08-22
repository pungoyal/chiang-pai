"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  beginJoinAction,
  beginSignupAction,
  finishJoinAction,
  finishSignupAction,
} from "@/app/actions";
import { createCredential } from "@/components/passkeys";
import { LINGO_KEYS, LINGOS } from "@/lib/lingo";
import { routes } from "@/lib/routes";

/**
 * Everything a new member does: pick a name, tick the box, make a passkey.
 * No address, no password, no account anywhere else. With a `code` it joins
 * the trip the link is for; without one it opens an account for whoever is
 * about to start the first trip. The server action redirects once the
 * signature checks out.
 */
export function JoinForm({ code, label }: { code?: string; label?: string }) {
  const [name, setName] = useState(label ?? "");
  const [lingo, setLingo] = useState("english");
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const join = () =>
    startTransition(async () => {
      setError(null);
      const made = await createCredential(
        () => (code ? beginJoinAction(code, name) : beginSignupAction(name)),
        "created",
      );
      if ("error" in made) {
        setError(made.error);
        return;
      }
      // Success redirects, so anything returned here is a refusal.
      const result = code
        ? await finishJoinAction({ code, name, lingo, agreed, response: made.wire })
        : await finishSignupAction({ name, lingo, agreed, response: made.wire });
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
      <label
        htmlFor="join-lingo"
        className="mt-4 block text-xs font-semibold uppercase tracking-wider text-soft"
      >
        How should it talk to you?
      </label>
      <select
        id="join-lingo"
        value={lingo}
        onChange={(e) => setLingo(e.target.value)}
        className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
      >
        {LINGO_KEYS.map((key) => (
          <option key={key} value={key}>
            {LINGOS[key].name}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-soft">Only changes your screen. Change it any time.</p>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1"
        />
        <span>
          I'm 18 or over and I agree to the{" "}
          <Link href={routes.terms} className="text-felt hover:underline" target="_blank">
            terms
          </Link>{" "}
          and{" "}
          <Link href={routes.privacy} className="text-felt hover:underline" target="_blank">
            privacy note
          </Link>
          . Pies are never money.
        </span>
      </label>

      <button
        type="button"
        onClick={join}
        disabled={pending || !agreed || name.trim().length < 2}
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
