import { RecoverForm } from "@/components/recover-form";
import { SignedOutCard, SignedOutNotice } from "@/components/signed-out-card";
import { getSession } from "@/lib/auth";
import { findRecovery, getMember } from "@/lib/data";
import { timeUntil } from "@/lib/format";
import { type RecoveryState, recoveryState } from "@/lib/recovery";

const EYEBROW = "Back to your seat";

/**
 * Where a recovery link lands. Unlike /join, walking through this does not
 * create anybody — it adds a key to a member who is already at the table, with
 * their pies, their bills, and their say on what resolved how. So the page
 * names whose seat it is, out loud, before offering the button: a link that
 * reached the wrong person should be obvious to that person immediately.
 */
export default async function RecoverPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [row, session] = await Promise.all([findRecovery(code), getSession()]);

  if (session) {
    return (
      <SignedOutNotice eyebrow={EYEBROW}>
        You're already signed in. If you're adding a device, do it from your own page instead.
      </SignedOutNotice>
    );
  }

  const state = row && recoveryState(row, new Date());
  if (!row || state !== "live") {
    return <SignedOutNotice eyebrow={EYEBROW}>{deadLink(state || null)}</SignedOutNotice>;
  }

  const [member, mintedBy] = await Promise.all([
    getMember(row.memberId),
    row.mintedBy ? getMember(row.mintedBy) : null,
  ]);
  if (!member) {
    return <SignedOutNotice eyebrow={EYEBROW}>That seat is gone.</SignedOutNotice>;
  }

  return (
    <SignedOutCard eyebrow={EYEBROW}>
      <p className="mt-3 text-sm text-soft">
        This link puts a new passkey on{" "}
        <span className="font-semibold text-ink">{member.name}</span>
        's seat — their pies, their bills, their word in the comments.
      </p>
      <p className="mt-3 rounded-md bg-gold/10 px-3 py-2 text-left text-xs text-soft">
        {mintedBy ? `${mintedBy.name} minted it` : "It was minted from the console"} · expires{" "}
        {timeUntil(row.expiresAt)}.
        <br />
        Everyone at the table can see this link exists. If you aren't {member.name}, close this and
        tell them.
      </p>
      <RecoverForm code={code} name={member.name} />
    </SignedOutCard>
  );
}

function deadLink(state: RecoveryState | null): string {
  if (state === "used") return "That recovery link has already been used.";
  if (state === "expired") return "That recovery link has expired — they take a moment to mint.";
  return "That recovery link isn't valid.";
}
