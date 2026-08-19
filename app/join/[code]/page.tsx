import Link from "next/link";
import { JoinForm } from "@/components/join-form";
import { Logo } from "@/components/logo";
import { getSession } from "@/lib/auth";
import { findInvite, getMember } from "@/lib/data";
import { inviteState } from "@/lib/invites";

/**
 * The whole of joining. Reachable signed out, by anyone holding the link —
 * which is the point, and the trade the invite table documents: the code is a
 * bearer token, kept short-lived and single-use because of it.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const invite = await findInvite(code);
  const state = invite ? inviteState(invite, new Date()) : null;
  const inviter = invite ? await getMember(invite.invitedBy) : null;
  const session = await getSession();

  return (
    <div className="mx-auto mt-10 max-w-sm overflow-hidden card text-center shadow-[0_2px_0_rgba(33,38,31,0.08)]">
      <div aria-hidden className="zari" />
      <div className="p-8">
        <Logo size={64} className="mx-auto rounded-2xl" />
        <p className="eyebrow mt-5">You've been invited</p>
        <p className="display mt-1 text-5xl font-extrabold uppercase leading-none tracking-wide">
          Chiang
          <br />
          Pai
        </p>

        {session ? (
          <>
            <p className="mt-4 text-sm text-soft">
              You're already at the table — this link is for someone else.
            </p>
            <Link href="/" className="mt-4 block text-sm font-semibold text-felt hover:underline">
              Go to the predictions →
            </Link>
          </>
        ) : state === "live" && invite ? (
          <>
            <p className="mt-3 text-sm text-soft">
              {inviter ? `${inviter.name} saved you a seat` : "A founding member saved you a seat"}.
              A private prediction game — virtual pies, real reputations.
            </p>
            <JoinForm code={code} label={invite.label} />
          </>
        ) : (
          <>
            <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
              {state === "used"
                ? "That link has already been used."
                : state === "expired"
                  ? "That link has expired."
                  : "That invite link isn't valid."}
            </p>
            <p className="mt-3 text-sm text-soft">
              Ask whoever invited you for a fresh one — they take a moment to mint.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
