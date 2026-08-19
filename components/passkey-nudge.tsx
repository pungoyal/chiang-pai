import Link from "next/link";
import { AddPasskeyButton } from "@/components/passkeys";

/**
 * Shown to every member who hasn't enrolled yet, on every page, until they do.
 * Google sign-in is going away and this is the one thing they have to do about
 * it — so the button is right here rather than a page away. Plain language in
 * every lingo: this is a notice, not flavour.
 */
export function PasskeyNudge({
  memberId,
  needsPicture,
}: {
  memberId: string;
  needsPicture: boolean;
}) {
  return (
    <div className="mx-auto mt-4 max-w-5xl px-4">
      <div className="card flex flex-wrap items-center gap-x-4 gap-y-3 border-gold/40 bg-gold/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Add a passkey — Google sign-in is going away.</p>
          <p className="text-sm text-soft">
            One tap with Face ID, a fingerprint, or your phone. No password, no email, nothing about
            you stored.
            {needsPicture && (
              <>
                {" "}
                While you're at it,{" "}
                <Link href={`/member/${memberId}`} className="text-felt hover:underline">
                  upload a picture
                </Link>{" "}
                — your Google photo is gone, and initials are standing in.
              </>
            )}
          </p>
        </div>
        <AddPasskeyButton prepareOn="intent" />
      </div>
    </div>
  );
}
