import Link from "next/link";
import { Talk } from "@/components/talk";
import { isOrganiser, listPhrases } from "@/lib/data";
import { lingoOf } from "@/lib/lingo";
import { llmEnabled } from "@/lib/llm";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";
import { speakEnabled } from "@/lib/speech";
import { pairFor } from "@/lib/talk";

/**
 * The one page in this app pointed at somebody who is not in the group.
 *
 * Nothing it does is recorded on its own: no turn, no clip, no transcript. The
 * conversation lives in the tab and ends with it, which is the only sensible
 * lifetime for a stranger's words.
 *
 * The exception is deliberate and is the member's, not the app's — a phrase
 * they pointed at and named is kept, for the whole trip to say again.
 */
export default async function TalkPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const ctx = await requireTrip(tripId);
  const { me, trip } = ctx;
  const t = lingoOf(me.lingo);
  const pair = pairFor(trip);
  if (!pair) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="eyebrow">Talk</p>
        <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
          Nothing to interpret
        </h1>
        <p className="mt-1 text-sm text-soft">
          This trip speaks the local language already.{" "}
          <Link href={routes.trip(tripId)} className="text-felt hover:underline">
            Back to the calls.
          </Link>
        </p>
      </div>
    );
  }
  const phrases = await listPhrases(tripId);
  return (
    <div className="mx-auto max-w-2xl">
      <p className="eyebrow">{pair.them.language}</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">
        {t.talkTitle(pair.them.language)}
      </h1>
      <p className="mb-6 mt-1 text-sm text-soft">{t.talkSub(pair.them.language)}</p>
      <Talk
        tripId={tripId}
        meId={me.id}
        organiser={isOrganiser(ctx)}
        pair={pair}
        canInterpret={llmEnabled}
        serverSpeaks={speakEnabled}
        phrases={phrases}
        phrasebookHeading={t.phrasebookHeading}
      />
    </div>
  );
}
