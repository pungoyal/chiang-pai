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
  isFounder,
  listAllowlist,
  listInvites,
  listMembers,
  listRecoveries,
  netOf,
  passkeyHolders,
} from "@/lib/data";
import { env } from "@/lib/env";
import { fmtDate, timeAgo, timeUntil } from "@/lib/format";
import { inviteUrl, partitionInvites } from "@/lib/invites";
import { lingoOf } from "@/lib/lingo";
import { requireMember } from "@/lib/session";
import { type Currency, fmtMoney } from "@/lib/split";

export default async function MembersPage() {
  const me = await requireMember();
  const t = lingoOf(me.lingo);
  const canInvite = isFounder(me);

  // None of these depend on each other; only the per-member balances do.
  const [all, invites, legacy, passkeys, recoveries, { balances: currencyBalances }] =
    await Promise.all([
      listMembers(),
      listInvites(),
      listAllowlist(),
      passkeyHolders(),
      listRecoveries(),
      billsOverview(),
    ]);
  const balances = await Promise.all(all.map((m) => netOf(m.id)));

  const { groupLink, personal } = partitionInvites(invites, new Date());
  const enrolled = all.filter((m) => passkeys.has(m.id)).length;
  const joined = new Set(all.map((m) => m.email).filter((e) => e != null));
  const pendingEmails = legacy.filter((i) => !joined.has(i.email));
  const nameById = new Map(all.map((m) => [m.id, m.name]));

  // Outstanding split-bill money per member — only members who aren't square.
  const moneyByMember = new Map<string, { currency: Currency; netC: number }[]>();
  for (const b of currencyBalances) {
    for (const { member, netC } of b.nets) {
      const list = moneyByMember.get(member.id) ?? [];
      list.push({ currency: b.currency, netC });
      moneyByMember.set(member.id, list);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">Members</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">{t.membersTitle}</h1>
      <p className="mt-1 text-sm text-soft">{t.membersSub}</p>

      <ul className="mt-5 card list">
        {all.map((m, i) => (
          <li key={m.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar member={m} size={34} />
            <div className="min-w-0">
              <Link href={`/member/${m.id}`} className="font-semibold hover:underline">
                {m.name}
                {m.id === me.id && <span className="font-normal text-soft"> (you)</span>}
              </Link>
              <p className="truncate text-xs text-soft">
                joined {fmtDate(m.joinedAt)} ·{" "}
                {passkeys.has(m.id) ? (
                  <span className="font-semibold text-felt">passkey ✓</span>
                ) : (
                  "no passkey yet"
                )}
              </p>
            </div>
            <span className="ml-auto flex flex-col items-end">
              <span className="mono font-bold">
                <Pies c={balances[i]} sign />
              </span>
              {moneyByMember.has(m.id) && (
                <Link
                  href="/bills"
                  title="Outstanding split-bill money"
                  className="mono text-[11px] hover:underline"
                >
                  {moneyByMember.get(m.id)!.map((x, j) => (
                    <Fragment key={x.currency}>
                      {j > 0 && <span className="text-soft"> · </span>}
                      <span className={tone(x.netC)}>
                        {fmtMoney(x.currency, x.netC, { sign: true })}
                      </span>
                    </Fragment>
                  ))}
                </Link>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-soft">
        {enrolled} of {all.length} members have added a passkey. Google sign-in comes out once
        that's everyone.
      </p>

      {(recoveries.live.length > 0 || recoveries.used.length > 0) && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Recovery links
          </h2>
          <p className="text-xs text-soft">
            A recovery link puts a new passkey on somebody's seat, so whoever opens it is them.
            Nothing stops a founder minting one — what stops it going unnoticed is this list, which
            everybody can read. If one names you and you didn't ask for it, shut it.
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
                  {(canInvite || r.member.id === me.id) && <ShutRecovery code={r.row.code} />}
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
                    invited by {nameById.get(i.invitedBy) ?? "a founder"} · link expires{" "}
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

      {pendingEmails.length > 0 && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invited by email, before links
          </h2>
          <p className="text-xs text-soft">These can still join with Google until it comes out.</p>
          <ul className="mt-2 space-y-1 text-sm text-soft">
            {pendingEmails.map((i) => (
              <li key={i.email}>{i.email}</li>
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
            <InviteForm />
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
