import Link from "next/link";
import { JoinForm } from "@/components/join-form";
import { SignedOutCard } from "@/components/signed-out-card";
import { getSession } from "@/lib/auth";
import { findInvite, getMember } from "@/lib/data";
import { type InviteState, inviteState } from "@/lib/invites";

/**
 * The whole of joining. Reachable signed out, by anyone holding the link —
 * which is the point, and the trade the invite table documents: the code is a
 * bearer token, kept short-lived and revocable because of it.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [invite, session] = await Promise.all([findInvite(code), getSession()]);

  if (session) {
    return <DeadEnd>You're already at the table — this link is for someone else.</DeadEnd>;
  }

  const state = invite && inviteState(invite, new Date());
  if (!invite || state !== "live") {
    return <DeadEnd>{deadLink(state || null)}</DeadEnd>;
  }

  const inviter = await getMember(invite.invitedBy);
  return (
    <SignedOutCard eyebrow="You've been invited">
      <p className="mt-3 text-sm text-soft">
        {inviter ? `${inviter.name} saved you a seat` : "A founding member saved you a seat"}. A
        private prediction game — virtual pies, real reputations.
      </p>
      <JoinForm code={code} label={invite.label} />
    </SignedOutCard>
  );
}

function deadLink(state: InviteState | null): string {
  if (state === "used") return "That link has already been used.";
  if (state === "expired") return "That link has expired.";
  return "That invite link isn't valid.";
}

function DeadEnd({ children }: { children: React.ReactNode }) {
  return (
    <SignedOutCard eyebrow="You've been invited">
      <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
        {children}
      </p>
      <Link href="/" className="mt-3 block text-sm font-semibold text-felt hover:underline">
        Go to the predictions →
      </Link>
    </SignedOutCard>
  );
}
