"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { betAction, switchAction } from "@/app/actions";
import type { Side } from "@/lib/engine";
import { lingoOf } from "@/lib/lingo";
import { Pies } from "./pies";

export function BetPanel({
  marketId,
  mySide,
  myStakeC,
  maxStakeC,
  lingo = "english",
}: {
  marketId: string;
  mySide: Side | null;
  myStakeC: number;
  maxStakeC: number;
  lingo?: string;
}) {
  const t = lingoOf(lingo);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pies, setPies] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Infinite bank: net going negative is fine, so the only ceiling is the
  // per-market exposure cap.
  const roomC = maxStakeC - myStakeC;
  const maxPies = Math.floor(roomC / 100);
  const clamped = Math.min(Math.max(pies, 1), Math.max(maxPies, 1));

  const bet = (side: Side) =>
    startTransition(async () => {
      setError(null);
      const res = await betAction(marketId, side, clamped);
      if (!res.ok) setError(res.error ?? t.oops);
      else router.refresh();
    });

  const switchSide = () =>
    startTransition(async () => {
      setError(null);
      const res = await switchAction(marketId);
      if (!res.ok) setError(res.error ?? t.oops);
      else router.refresh();
    });

  const other: Side = mySide === "yes" ? "no" : "yes";

  return (
    <div className="card p-4">
      <h3 className="display text-lg font-bold uppercase tracking-wide text-soft">Make a call</h3>

      {maxPies < 1 ? (
        <p className="mt-2 text-sm text-soft">{t.stakeLimit}</p>
      ) : (
        <>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex items-center rounded-md border border-line">
              <button
                type="button"
                aria-label="One pie less"
                className="px-3 py-2 text-lg leading-none text-soft hover:text-ink disabled:opacity-30"
                disabled={clamped <= 1 || pending}
                onClick={() => setPies(clamped - 1)}
              >
                −
              </button>
              <span className="mono w-10 text-center text-lg font-bold">{clamped}</span>
              <button
                type="button"
                aria-label="One pie more"
                className="px-3 py-2 text-lg leading-none text-soft hover:text-ink disabled:opacity-30"
                disabled={clamped >= maxPies || pending}
                onClick={() => setPies(clamped + 1)}
              >
                +
              </button>
            </div>
            <span className="text-xs text-soft">
              pies · room for <Pies c={roomC} /> more here
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={pending || mySide === "no"}
              onClick={() => bet("yes")}
              className="display rounded-md bg-yes py-2.5 text-lg font-bold uppercase text-white hover:bg-yes-press disabled:cursor-not-allowed disabled:opacity-40"
            >
              Call YES
            </button>
            <button
              type="button"
              disabled={pending || mySide === "yes"}
              onClick={() => bet("no")}
              className="display rounded-md bg-no py-2.5 text-lg font-bold uppercase text-white hover:bg-no-press disabled:cursor-not-allowed disabled:opacity-40"
            >
              Call NO
            </button>
          </div>
        </>
      )}

      {mySide && (
        <div className="mt-3 border-t border-line pt-3 text-sm">
          <p>
            You called{" "}
            <span className="mono font-bold">
              <Pies c={myStakeC} />
            </span>{" "}
            on <span className="font-bold uppercase">{mySide}</span>.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={switchSide}
            className="mt-1.5 rounded-md border border-line px-3 py-1.5 font-semibold hover:bg-paper disabled:opacity-40"
          >
            Switch your whole call to {other.toUpperCase()}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm font-semibold text-no-deep">{error}</p>}
      {pending && <p className="mt-3 text-sm text-soft">{t.recording}</p>}
    </div>
  );
}
