import Link from "next/link";
import { Fragment } from "react";
import { Avatar } from "@/components/avatar";
import { InviteForm } from "@/components/invite-form";
import { Pies } from "@/components/pies";
import { tone } from "@/components/ui";
import {
  billsOverview,
  isFounder,
  listInvites,
  listMembers,
  netOf,
  passkeyCounts,
} from "@/lib/data";
import { fmtDate } from "@/lib/format";
import { lingoOf } from "@/lib/lingo";
import { requireMember } from "@/lib/session";
import { type Currency, fmtMoney } from "@/lib/split";

export default async function MembersPage() {
  const me = await requireMember();
  const t = lingoOf(me.lingo);
  const all = await listMembers();
  const invites = await listInvites();
  const balances = await Promise.all(all.map((m) => netOf(m.id)));
  const passkeys = await passkeyCounts();
  const enrolled = all.filter((m) => passkeys.has(m.id)).length;
  const joinedEmails = new Set(all.map((m) => m.email));
  const pending = invites.filter((i) => !joinedEmails.has(i.email));

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
                {m.email} · joined {fmtDate(m.joinedAt)} ·{" "}
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

      {pending.length > 0 && (
        <section className="mt-6">
          <h2 className="display text-lg font-bold uppercase tracking-wide text-soft">
            Invited, not yet at the table
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-soft">
            {pending.map((i) => (
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
            They sign in with the Google account for this email and can bet straight away.
          </p>
          <div className="mt-2">
            <InviteForm />
          </div>
        </section>
      )}
    </div>
  );
}
