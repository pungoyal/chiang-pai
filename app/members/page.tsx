import Link from "next/link";
import { Fragment } from "react";
import { Avatar } from "@/components/avatar";
import { InviteForm } from "@/components/invite-form";
import { Pies } from "@/components/pies";
import { RevokeInvite } from "@/components/revoke-invite";
import { tone } from "@/components/ui";
import {
  billsOverview,
  isFounder,
  listAllowlist,
  listInvites,
  listMembers,
  netOf,
  passkeyCounts,
} from "@/lib/data";
import { env } from "@/lib/env";
import { fmtDate } from "@/lib/format";
import { inviteState } from "@/lib/invites";
import { lingoOf } from "@/lib/lingo";
import { requireMember } from "@/lib/session";
import { type Currency, fmtMoney } from "@/lib/split";

export default async function MembersPage() {
  const me = await requireMember();
  const t = lingoOf(me.lingo);
  const all = await listMembers();
  const invites = await listInvites();
  const legacy = await listAllowlist();
  const balances = await Promise.all(all.map((m) => netOf(m.id)));
  const passkeys = await passkeyCounts();
  const enrolled = all.filter((m) => passkeys.has(m.id)).length;
  const now = new Date();
  const liveInvites = invites.filter((i) => inviteState(i, now) === "live");
  const joinedEmails = new Set(all.map((m) => m.email).filter((e) => e != null));
  const pendingEmails = legacy.filter((i) => !joinedEmails.has(i.email));
  const nameById = new Map(all.map((m) => [m.id, m.name]));

  // Outstanding split-bill money per member — only members who aren't square.
  const { balances: currencyBalances } = await billsOverview();
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

      {liveInvites.length > 0 && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invited, not yet at the table
          </h2>
          <ul className="mt-2 card list">
            {liveInvites.map((i) => (
              <li key={i.codeHash} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {i.label}
                  <span className="text-soft">
                    {" · "}
                    invited by {nameById.get(i.invitedBy) ?? "a founder"} · link expires{" "}
                    {fmtDate(i.expiresAt)}
                  </span>
                </span>
                {isFounder(me) && <RevokeInvite codeHash={i.codeHash} />}
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

      {isFounder(me) && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invite a friend
          </h2>
          <p className="text-xs text-soft">
            Mint a link and send it however you'd normally reach them. They pick a name, make a
            passkey, and they're in — no email, no Google account.
          </p>
          <div className="mt-2">
            <InviteForm baseUrl={env.AUTH_URL} />
          </div>
        </section>
      )}
    </div>
  );
}
