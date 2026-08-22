import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityFeed } from "@/components/activity";
import { Avatar } from "@/components/avatar";
import { BetPanel } from "@/components/bet-panel";
import { CommentsSection } from "@/components/comments";
import { Pies } from "@/components/pies";
import { PoolBar } from "@/components/pool-bar";
import { ReactionBar } from "@/components/reaction-bar";
import { RecordView } from "@/components/record-view";
import { ReopenPanel } from "@/components/reopen-panel";
import { ResolvePanel } from "@/components/resolve-panel";
import { ShareCard } from "@/components/share-card";
import { SideChip, StatusChip } from "@/components/side-chip";
import { getMarketView, isOrganiser, membersOf } from "@/lib/data";
import { fmtDate, timeAgo } from "@/lib/format";
import { lingoOf } from "@/lib/lingo";
import { toCents } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";

export default async function MarketPage({
  params,
}: {
  params: Promise<{ tripId: string; id: string }>;
}) {
  const { tripId, id } = await params;
  const ctx = await requireTrip(tripId);
  const { me, trip } = ctx;
  const t = lingoOf(me.lingo);
  const data = await getMarketView(id, me.id);
  if (!data || data.trip.id !== tripId) notFound();
  const members = await membersOf(tripId);
  const { view, activity, settlements, comments, seenBy, upvoters, watchers } = data;
  const { market, creator } = view;
  const isOpen = market.status === "open";
  const totalPoolC = view.yesPoolC + view.noPoolC;
  const pulse = [
    view.participants.length > 0 &&
      `${view.participants.length} backer${view.participants.length === 1 ? "" : "s"}`,
    activity.length > 0 && `${activity.length} call${activity.length === 1 ? "" : "s"}`,
    seenBy > 0 && `seen by ${seenBy}`,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-3xl">
      <RecordView marketId={market.id} />
      <Link href={routes.trip(tripId)} className="text-sm text-soft hover:text-ink">
        ← All predictions
      </Link>

      <div className="mt-3 flex items-center justify-between gap-3">
        <StatusChip status={market.status} />
        <span className="text-sm text-soft">
          by {creator.name} · {timeAgo(market.createdAt)}
        </span>
      </div>

      <h1 className="display mt-2 text-4xl font-extrabold leading-tight">{market.question}</h1>

      <ReactionBar
        marketId={market.id}
        meId={me.id}
        upvoters={upvoters.map((m) => ({
          id: m.id,
          name: m.name,
          avatarUpdatedAt: m.avatarUpdatedAt,
        }))}
        watchers={watchers.map((m) => ({
          id: m.id,
          name: m.name,
          avatarUpdatedAt: m.avatarUpdatedAt,
        }))}
        open={isOpen}
        lingo={me.lingo}
      />

      <div className="mt-3 card p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">Resolves how</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{market.criteria}</p>
      </div>

      {!isOpen && (
        <div className="mt-4 rounded-lg border border-gold/40 bg-surface p-4">
          <p className="display text-lg font-bold uppercase tracking-wide">
            {market.status === "yes" || market.status === "no" ? (
              <span className="flex items-center gap-2">
                Resolved <SideChip side={market.status} />
              </span>
            ) : (
              "Voided — all pies returned"
            )}
          </p>
          <p className="mt-1 text-xs text-soft">
            by {creator.name}
            {market.resolvedAt && <> on {fmtDate(market.resolvedAt)}</>}
          </p>
          {market.resolutionNote && (
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">{market.resolutionNote}</p>
          )}
          {settlements.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-soft">
                Where the <Pies c={totalPoolC} /> pool went
              </p>
              <ul className="mt-2 space-y-1.5">
                {settlements.map((s) => (
                  <li key={s.row.id} className="flex items-center gap-2 text-sm">
                    <Avatar member={s.member} size={20} />
                    <span className="font-semibold">{s.member.name}</span>
                    <span className="text-soft">
                      {s.row.kind === "payout" ? "collected" : "refunded"}
                    </span>
                    <span className="mono ml-auto font-bold">
                      <Pies c={s.row.amountC} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ShareCard marketId={market.id} question={market.question} tripName={trip.name} />
          {isOrganiser(ctx) && <ReopenPanel marketId={market.id} />}
        </div>
      )}

      <div className="mt-5">
        <PoolBar yesPoolC={view.yesPoolC} noPoolC={view.noPoolC} lingo={me.lingo} />
        {totalPoolC > 0 && (
          <p className="mono mt-1 text-center text-xs text-soft">
            <Pies c={totalPoolC} /> in the pool
          </p>
        )}
        {pulse.length > 0 && (
          <p className="mt-1 text-center text-xs text-soft">{pulse.join(" · ")}</p>
        )}
      </div>

      {/* Who believes what */}
      <section className="mt-5">
        <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">Calls</h2>
        {view.participants.length === 0 ? (
          <p className="mt-2 text-sm text-soft">{t.betsEmpty}</p>
        ) : (
          <ul className="mt-2 card list">
            {view.participants.map((p) => (
              <li key={p.member.id} className="flex items-center gap-3 px-4 py-2.5">
                <Avatar member={p.member} size={28} />
                <Link
                  href={routes.member(tripId, p.member.id)}
                  className="font-semibold hover:underline"
                >
                  {p.member.name}
                  {p.member.id === me.id && <span className="text-soft"> (you)</span>}
                </Link>
                <span className="ml-auto flex items-center gap-2">
                  <span className="mono font-bold">
                    <Pies c={p.stakeC} />
                  </span>
                  <SideChip side={p.side} small />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isOpen && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <BetPanel
            marketId={market.id}
            mySide={view.mySide}
            myStakeC={view.myStakeC}
            maxStakeC={toCents(trip.maxStakePies)}
            lingo={me.lingo}
          />
          {market.creatorId === me.id && <ResolvePanel marketId={market.id} lingo={me.lingo} />}
        </div>
      )}

      <section className="mt-7">
        <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
          {t.commentsHeading}
        </h2>
        <div className="mt-3 card p-4">
          <CommentsSection
            target={{ marketId: market.id }}
            comments={comments}
            members={members}
            meId={me.id}
            lingo={me.lingo}
          />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
          {t.activitySoFarHeading}
        </h2>
        <div className="mt-3">
          <ActivityFeed items={activity} lingo={me.lingo} />
        </div>
      </section>
    </div>
  );
}
