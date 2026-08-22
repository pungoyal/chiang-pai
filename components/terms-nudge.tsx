"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acceptTermsAction } from "@/app/actions";
import { routes } from "@/lib/routes";

/**
 * For members who predate the gate: once, on every page, until they tick it.
 * Plain language — this is a notice, not flavour — and it blocks nothing; it
 * only records the moment they agreed.
 */
export function TermsNudge() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-gold/40 bg-gold/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">One tick before you carry on.</p>
          <p className="text-sm text-soft">
            Chiang Pai is for adults, pies are never money, and we keep only what the game needs.
            Read the{" "}
            <Link href={routes.terms} className="text-felt hover:underline">
              terms
            </Link>{" "}
            and{" "}
            <Link href={routes.privacy} className="text-felt hover:underline">
              privacy note
            </Link>
            , then confirm you're 18 or over.
          </p>
          {error && <p className="mt-1 text-xs text-no-deep">{error}</p>}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await acceptTermsAction();
              if (!r.ok) setError(r.error ?? "Try again.");
            })
          }
          className="rounded-md bg-felt px-4 py-2 text-sm font-semibold text-white hover:bg-felt-deep disabled:opacity-60"
        >
          I'm 18+ and I agree
        </button>
      </div>
    </div>
  );
}
