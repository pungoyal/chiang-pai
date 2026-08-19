"use client";

import { useState, useTransition } from "react";
import { beginJoinAction, finishJoinAction } from "@/app/actions";
import { createCredential, usePreparedCeremony } from "@/components/passkeys";
import { LINGO_KEYS, LINGOS } from "@/lib/lingo";

/**
 * Everything a new member does: pick a name, make a passkey. No address, no
 * password, no account anywhere else. The server action redirects home once the
 * signature checks out and the link is spent.
 */
export function JoinForm({ code, suggestedName }: { code: string; suggestedName: string }) {
  const [name, setName] = useState(suggestedName);
  const [lingo, setLingo] = useState("english");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const usable = name.trim().length >= 2;

  // Prepared as soon as the name is usable, and again whenever it changes —
  // the name is what the authenticator will show in its own list.
  const ceremony = usePreparedCeremony(() => beginJoinAction(code, name), {
    when: "mount",
    ready: usable,
    key: name.trim(),
  });

  const join = () => {
    const ready = ceremony.take();
    ceremony.spend();
    startTransition(async () => {
      setError(null);
      const made = await createCredential(ready ?? (await beginJoinAction(code, name)), "created");
      if ("error" in made) {
        setError(made.error);
        return;
      }
      // Success redirects, so anything returned here is a refusal.
      const result = await finishJoinAction({ code, name, lingo, response: made.wire });
      setError(result.error ?? "That didn't work.");
    });
  };

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

      <button
        type="button"
        onClick={join}
        disabled={pending || !usable}
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
