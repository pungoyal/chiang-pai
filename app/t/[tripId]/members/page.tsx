import Link from "next/link";
import { Fragment } from "react";
import { Avatar } from "@/components/avatar";
import { CopyLink } from "@/components/copy-link";
import { GroupLink } from "@/components/group-link";
import { InviteForm } from "@/components/invite-form";
import { Pies } from "@/components/pies";
import { ShutRecovery } from "@/components/recovery";
import { RevokeInvite } from "@/components/revoke-invite";
import { tone } from "@/components/ui";
import {
  billsOverview,
  isOrganiser,
  leaderboard,
  listInvites,
  listRecoveries,
  type MemberStats,
  passkeyHolders,
} from "@/lib/data";
import { env } from "@/lib/env";
import { fmtDate, timeAgo, timeUntil } from "@/lib/format";
import { inviteUrl, partitionInvites } from "@/lib/invites";
import { lingoOf } from "@/lib/lingo";
import { fmtPct } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { type Currency, fmtMoney } from "@/lib/split";

/** What a member is owed (or owes) in one currency, from the split bills. */
type Money = { currency: Currency; netC: number };

export default async function MembersPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const ctx = await requireTrip(tripId);
  const { me } = ctx;
  const t = lingoOf(me.lingo);
  const canInvite = isOrganiser(ctx);

  // None of these depend on each other. The leaderboard already replays every
  // member's balance, so nobody's net needs a query of its own.
  const [{ ranked, unranked }, invites, passkeys, recoveries, { balances }] = await Promise.all([
    leaderboard(tripId),
    listInvites(tripId),
    passkeyHolders(tripId),
    listRecoveries(tripId),
    billsOverview(tripId),
  ]);
  const all = [...ranked, ...unranked];

  const { groupLink, personal } = partitionInvites(invites, new Date());
  const enrolled = all.filter((s) => passkeys.has(s.member.id)).length;
  const nameById = new Map(all.map((s) => [s.member.id, s.member.name]));

  // Outstanding split-bill money per member — only members who aren't square.
  const moneyByMember = new Map<string, Money[]>();
  for (const b of balances) {
    for (const { member, netC } of b.nets) {
      const list = moneyByMember.get(member.id) ?? [];
      list.push({ currency: b.currency, netC });
      moneyByMember.set(member.id, list);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <p className="eyebrow">The table</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.membersTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.membersSub}</p>

      <h2 className="display mt-6 text-xl font-bold uppercase tracking-wide">
        {t.leaderboardTitle}
      </h2>
      <p className="text-xs text-soft">{t.leaderboardSub(env.RANKED_MIN_RESOLVED)}</p>
      {ranked.length === 0 && (
        <p className="mt-1 text-xs text-soft">
          {t.leaderboardEmptyTitle} Nobody has {env.RANKED_MIN_RESOLVED} resolved predictions yet —
          reputations are made early.
        </p>
      )}

      <div className="mt-3 overflow-x-auto card">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-wider text-soft">
              <th className="px-4 py-2.5">#</th>
              <th className="px-2 py-2.5">Predictor</th>
              <th className="px-2 py-2.5 text-right">Return</th>
              <th className="px-2 py-2.5 text-right">Profit</th>
              <th className="px-2 py-2.5 text-right">Record</th>
              <th className="px-2 py-2.5 text-right">Put up</th>
              <th className="px-4 py-2.5 text-right">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ranked.map((s, i) => (
              <Row
                key={s.member.id}
                s={s}
                rank={i + 1}
                isMe={s.member.id === me.id}
                hasPasskey={passkeys.has(s.member.id)}
                money={moneyByMember.get(s.member.id)}
                tripId={tripId}
              />
            ))}
            {unranked.length > 0 && (
              <tr className="bg-felt-tint/40">
                <td
                  colSpan={7}
                  className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-soft"
                >
                  Calibrating — {t.calibratingSub}
                </td>
              </tr>
            )}
            {unranked.map((s) => (
              <Row
                key={s.member.id}
                s={s}
                rank={null}
                isMe={s.member.id === me.id}
                hasPasskey={passkeys.has(s.member.id)}
                money={moneyByMember.get(s.member.id)}
                tripId={tripId}
              />
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-soft">
        {enrolled} of {all.length} on this trip have added a passkey.
      </p>

      {(recoveries.live.length > 0 || recoveries.used.length > 0) && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Recovery links
          </h2>
          <p className="text-xs text-soft">
            A recovery link puts a new passkey on somebody's seat, so whoever opens it is them.
            Nothing stops an organiser minting one — what stops it going unnoticed is this list,
            which everybody can read. If one names you and you didn't ask for it, shut it.
          </p>

          {recoveries.live.length > 0 && (
            <ul className="mt-2 card list border-gold/40">
              {recoveries.live.map((r) => (
                <li
                  key={r.row.code}
                  className="flex items-center gap-3 bg-gold/10 px-4 py-2.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">{r.member.name}</span>
                    <span className="text-soft">
                      {" · "}
                      minted by {r.mintedBy ? r.mintedBy.name : "the console"} · expires{" "}
                      {timeUntil(r.row.expiresAt)}
                    </span>
                  </span>
                  {/* Whoever the link is for can always shut it — see revokeRecovery. */}
                  {(canInvite || r.member.id === me.id) && (
                    <ShutRecovery tripId={tripId} code={r.row.code} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {recoveries.used.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-soft">
              {recoveries.used.map((r) => (
                <li key={r.row.code}>
                  {r.member.name} came back through a link
                  {r.mintedBy ? ` from ${r.mintedBy.name}` : " from the console"}
                  {r.row.usedAt ? ` · ${timeAgo(r.row.usedAt)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {personal.length > 0 && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invited, not yet at the table
          </h2>
          <ul className="mt-2 card list">
            {personal.map((i) => (
              <li key={i.code} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {i.label}
                  <span className="text-soft">
                    {" · "}
                    invited by {nameById.get(i.invitedBy) ?? "an organiser"} · link expires{" "}
                    {fmtDate(i.expiresAt)}
                  </span>
                </span>
                {/* A live link is an invitation in itself, so only the people
                    allowed to invite can lift one off this page. */}
                {canInvite && <CopyLink url={inviteUrl(env.AUTH_URL, i.code)} compact />}
                {canInvite && <RevokeInvite code={i.code} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canInvite && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invite a friend
          </h2>
          <p className="text-xs text-soft">
            Mint a link and send it however you'd normally reach them. They pick a name, make a
            passkey, and they're in — no email, no Google account.
          </p>
          <div className="mt-2">
            <InviteForm tripId={tripId} />
          </div>

          <h2 className="display mt-6 text-lg font-bold uppercase tracking-wide text-soft">
            Or one link for the group
          </h2>
          <p className="text-xs text-soft">
            Anyone holding it can join, as often as people click it, for thirty days. Paste it in
            the group chat — and shut it if it ever ends up somewhere else.
          </p>
          <div className="mt-2">
            <GroupLink
              tripId={tripId}
              existing={
                groupLink && {
                  code: groupLink.code,
                  url: inviteUrl(env.AUTH_URL, groupLink.code),
                  expiresAt: groupLink.expiresAt,
                  useCount: groupLink.useCount,
                }
              }
            />
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One member: who they are on the left, how they've predicted on the right.
 * `rank` is null for the calibrating ones below the line, who get their
 * progress towards being ranked in the same cell instead.
 */
function Row({
  s,
  rank,
  isMe,
  hasPasskey,
  money,
  tripId,
}: {
  s: MemberStats;
  rank: number | null;
  isMe: boolean;
  hasPasskey: boolean;
  money: Money[] | undefined;
  tripId: string;
}) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
  return (
    <tr className={isMe ? "bg-felt-tint/50" : undefined}>
      <td className="px-4 py-2.5">
        {rank === null ? (
          <span className="mono text-[11px] text-soft">
            {s.resolvedCount}/{env.RANKED_MIN_RESOLVED}
          </span>
        ) : (
          <span className="display text-lg font-bold">{medal}</span>
        )}
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-2">
          <Avatar member={s.member} size={30} />
          <div className="min-w-0">
            <Link
              href={routes.member(tripId, s.member.id)}
              className="font-semibold hover:underline"
            >
              {s.member.name}
              {isMe && <span className="font-normal text-soft"> (you)</span>}
            </Link>
            <p className="truncate text-[11px] text-soft">
              joined {fmtDate(s.member.joinedAt)} ·{" "}
              {hasPasskey ? (
                <span className="font-semibold text-felt">passkey ✓</span>
              ) : (
                "no passkey yet"
              )}
              {/* Who can invite is everybody's business, not just theirs. */}
              {s.role === "organiser" && <span className="text-gold"> · organiser</span>}
            </p>
          </div>
        </div>
      </td>
      <td
        className={`mono px-2 py-2.5 text-right text-base font-bold ${
          (s.roi ?? 0) > 0 ? "text-felt" : (s.roi ?? 0) < 0 ? "text-no-deep" : ""
        }`}
      >
        {s.roi === null ? "—" : fmtPct(s.roi)}
      </td>
      <td className="mono px-2 py-2.5 text-right">
        <Pies c={s.profitC} sign />
      </td>
      <td className="mono px-2 py-2.5 text-right">
        {s.wins}–{s.losses}
      </td>
      <td className="mono px-2 py-2.5 text-right">
        <Pies c={s.wageredC} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className="mono font-semibold">
          <Pies c={s.netC} sign />
        </span>
        {money && (
          <Link
            href={routes.bills(tripId)}
            title="Outstanding split-bill money"
            className="mono block text-[11px] hover:underline"
          >
            {money.map((x, j) => (
              <Fragment key={x.currency}>
                {j > 0 && <span className="text-soft"> · </span>}
                <span className={tone(x.netC)}>{fmtMoney(x.currency, x.netC, { sign: true })}</span>
              </Fragment>
            ))}
          </Link>
        )}
      </td>
    </tr>
  );
}
