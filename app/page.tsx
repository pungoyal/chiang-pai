import Link from "next/link";
import { redirect } from "next/navigation";
import { JoinForm } from "@/components/join-form";
import { Logo } from "@/components/logo";
import { googleConfigured, passkeysConfigured } from "@/lib/auth";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";

/**
 * The front door, for somebody who has never seen the app. One promise, three
 * things it does, the one legal line that matters, and the form that opens a
 * trip. Members never see it — they land on their trips.
 */
export default async function Landing() {
  const me = await currentMember();
  if (me) redirect(routes.trips);

  return (
    <div className="mx-auto max-w-3xl">
      <section className="mt-6 text-center">
        <Logo size={72} className="mx-auto rounded-2xl" />
        <p className="eyebrow mt-5">For the group chat that never books</p>
        <h1 className="display mt-2 text-5xl font-extrabold uppercase leading-none tracking-wide sm:text-7xl">
          The trip that
          <br />
          actually happens
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-soft">
          Open a trip, drop one link in the group, and put the arguments on the record:{" "}
          <em>
            will everyone book by Friday, who's last to the airport, who gets the tuk-tuk under a
            hundred baht.
          </em>{" "}
          Play-money pies, a leaderboard, and a verdict card built for the chat.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a
            href="#start"
            className="display rounded-md bg-felt px-5 py-3 text-xl font-bold uppercase text-white hover:bg-felt-deep"
          >
            Start a trip
          </a>
          <Link
            href={routes.signin}
            className="rounded-md border border-line px-5 py-3 font-semibold hover:bg-surface"
          >
            Sign in
          </Link>
        </div>
        <p className="mt-3 text-xs text-soft">
          Free. No money, ever. Your friends join by link — no app store, no email.
        </p>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Feature
          title="Call it"
          body="Any member opens a prediction with plain resolution rules. Everyone backs YES or NO with pies. Winners split exactly what losers put in — zero-sum, no house, no odds."
        />
        <Feature
          title="Split it"
          body="Bills in the money you're spending and the money you're settling — two currencies, never more, decided when the trip opens. Who owes whom, in the fewest transfers."
        />
        <Feature
          title="Say it"
          body="Tap, speak, hand the phone over: it comes back in Thai, Vietnamese, Bahasa. Keep the phrases that worked in a phrasebook the whole trip can play."
        />
      </section>

      <section className="mt-12 rounded-lg border border-gold/40 bg-surface p-5 text-sm">
        <p className="display text-lg font-bold uppercase tracking-wide">The one rule</p>
        <p className="mt-1 text-soft">
          Pies are points. They are never bought, never sold, never cashed out, and the app never
          records, links, or settles money on a prediction. Loser buys dinner is your business; we
          just keep score. 18+ only.{" "}
          <Link href={routes.terms} className="text-felt hover:underline">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href={routes.privacy} className="text-felt hover:underline">
            Privacy
          </Link>
        </p>
      </section>

      <section id="start" className="mx-auto mt-12 max-w-sm card p-6">
        <p className="eyebrow">Start a trip</p>
        <p className="display text-3xl font-extrabold uppercase tracking-wide">
          You're the planner
        </p>
        <p className="mt-1 text-sm text-soft">
          Make a passkey — Face ID, a fingerprint, your phone — and open the first trip. Takes a
          minute.
        </p>
        {passkeysConfigured ? (
          <JoinForm />
        ) : (
          <p className="mt-4 text-sm text-no-deep">Passkeys aren't available on this host.</p>
        )}
        {googleConfigured && (
          <p className="mt-4 text-center text-xs text-soft">
            Rather use Google?{" "}
            <Link href={routes.signin} className="text-felt hover:underline">
              Sign in that way
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-4">
      <p className="display text-2xl font-extrabold uppercase tracking-wide">{title}</p>
      <p className="mt-1 text-sm text-soft">{body}</p>
    </div>
  );
}
