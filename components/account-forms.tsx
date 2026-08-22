"use client";

import { useState, useTransition } from "react";
import { deleteAccountAction, setNameAction } from "@/app/actions";

/** Rename, and the door out. Both plain: these are notices, not flavour. */
export function AccountForms({ name: initialName }: { name: string }) {
  const [name, setName] = useState(initialName);
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <section className="mt-7">
        <h2 className="display text-xl font-bold uppercase tracking-wide text-soft">Your name</h2>
        <p className="text-xs text-soft">
          What every table calls you. Has to be distinct on each trip you're on — it's how @mentions
          find you.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="w-64 rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || name.trim() === initialName || name.trim().length < 2}
            onClick={() =>
              start(async () => {
                setError(null);
                setNote(null);
                const r = await setNameAction(name);
                if (!r.ok) setError(r.error ?? "That didn't work.");
                else setNote("Renamed.");
              })
            }
            className="rounded-md border border-line px-3 py-2 text-sm font-semibold hover:bg-surface disabled:opacity-40"
          >
            Rename
          </button>
          {note && <span className="self-center text-xs text-soft">{note}</span>}
        </div>
      </section>

      <section className="mt-10 rounded-lg border border-no/40 p-4">
        <h2 className="display text-xl font-bold uppercase tracking-wide text-no-deep">
          Delete your account
        </h2>
        <p className="mt-1 text-xs text-soft">
          Your name, email, picture, passkeys, kept phrases, and seats go at once, and nothing can
          sign in as you again. What stays is the record every trip keeps of its own game — the pies
          you won and lost, the bills you were on, the comments you wrote — under "Departed member",
          because an append-only ledger can't forget a payout without breaking everybody else's
          numbers. Type DELETE to confirm.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="DELETE"
            className="mono w-40 rounded-md border border-line bg-surface px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={pending || confirm !== "DELETE"}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await deleteAccountAction(confirm);
                if (r && !r.ok) setError(r.error ?? "That didn't work.");
              })
            }
            className="rounded-md bg-no px-3 py-2 text-sm font-semibold text-white hover:bg-no-deep disabled:opacity-40"
          >
            Delete my account
          </button>
        </div>
        {error && <p className="mt-2 text-sm font-semibold text-no-deep">{error}</p>}
      </section>
    </>
  );
}
