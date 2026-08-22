import Link from "next/link";
import { JoinAsMember } from "@/components/join-as-member";
import { JoinForm } from "@/components/join-form";
import { SignedOutCard, SignedOutNotice } from "@/components/signed-out-card";
import { findInvite, tripFor, tripPreview } from "@/lib/data";
import { type InviteState, inviteState } from "@/lib/invites";
import { routes, signInThen } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import { DESTINATIONS } from "@/lib/talk";

/**
 * The whole of joining. Reachable signed out, by anyone holding the link —
 * which is the point, and the trade the invite table documents: the code is a
 * bearer token, kept short-lived and revocable because of it.
 *
 * Whoever opens it sees the table before they sit down: the trip, who is on
 * it, and what is being argued about. That is the invitation.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [invite, me] = await Promise.all([findInvite(code), currentMember()]);

  const state = invite && inviteState(invite, new Date());
  if (!invite || state !== "live") {
    return (
      <SignedOutNotice eyebrow="You've been invited">{deadLink(state || null)}</SignedOutNotice>
    );
  }

  const preview = await tripPreview(invite.tripId);
  if (!preview) {
    return <SignedOutNotice eyebrow="You've been invited">That trip is gone.</SignedOutNotice>;
  }
  const there = DESTINATIONS[preview.trip.destination];

  if (me && (await tripFor(me.id, invite.tripId))) {
    return (
      <SignedOutCard eyebrow="You've been invited">
        <p className="mt-3 text-sm text-soft">You're already on {preview.trip.name}.</p>
        <Link
          href={routes.trip(invite.tripId)}
          className="mt-4 block w-full rounded-md bg-felt py-3 font-semibold text-white hover:bg-felt-deep"
        >
          Open the trip
        </Link>
      </SignedOutCard>
    );
  }

  return (
    <SignedOutCard eyebrow="You've been invited">
      <div className="mt-4 rounded-lg border border-line bg-surface p-4 text-left">
        <p className="eyebrow">
          {there?.flag} {there?.place ?? preview.trip.destination}
        </p>
        <p className="display text-2xl font-extrabold uppercase tracking-wide">
          {preview.trip.name}
        </p>
        <p className="mt-1 text-sm text-soft">
          {preview.organiser ? `${preview.organiser.name} saved you a seat. ` : ""}
          {preview.memberCount} at the table
          {preview.names.length > 0 && `: ${preview.names.join(", ")}`}
          {preview.memberCount > preview.names.length && "…"}
        </p>
        {preview.questions.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            {preview.questions.map((q) => (
              <li key={q} className="flex gap-2">
                <span aria-hidden className="text-gold">
                  ◆
                </span>
                <span className="font-semibold">{q}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="mt-3 text-sm text-soft">
        Call who shows up, who's late, who pays. Play-money pies, real bragging rights.
      </p>

      {me ? (
        <JoinAsMember code={code} name={me.name} tripName={preview.trip.name} />
      ) : (
        <>
          <JoinForm code={code} label={invite.label} />
          <p className="mt-4 text-xs text-soft">
            Already on another trip?{" "}
            <Link href={signInThen(routes.join(code))} className="text-felt hover:underline">
              Sign in
            </Link>{" "}
            and this link will seat you.
          </p>
        </>
      )}
    </SignedOutCard>
  );
}

function deadLink(state: InviteState | null): string {
  if (state === "used") return "That link has already been used.";
  if (state === "expired") return "That link has expired.";
  return "That invite link isn't valid.";
}
