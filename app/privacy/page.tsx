import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

/**
 * What is kept, why, and for how long — written so a member can read it on a
 * phone. Drafted against the DPDP Act 2023 (India) and the GDPR; a lawyer
 * should read it before the app is marketed at scale.
 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl">
      <p className="eyebrow">Privacy</p>
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">What we keep</h1>
      <p className="text-sm text-soft">Last updated 22 August 2026.</p>

      <Section title="Who is responsible">
        The app is operated by an individual in India, who is the data fiduciary (DPDP Act, 2023)
        and data controller (GDPR) for it. Write to the grievance address in the footer of any email
        we send, or open an issue on the repository, for anything below.
      </Section>

      <Section title="What we store, and why">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Your name and the lingo you chose</b> — so your friends know who called what and the
            app can talk to you the way you asked.
          </li>
          <li>
            <b>An email address</b>, only if you sign in with Google. We take the address and your
            name from Google and nothing else — not your picture, not your contacts.
          </li>
          <li>
            <b>Passkeys</b>: a credential id, a public key, and a counter. Nothing that identifies
            your device or its make. The private key never leaves your device.
          </li>
          <li>
            <b>A picture</b>, only if you upload one. Otherwise a monogram is drawn from your
            initials.
          </li>
          <li>
            <b>The game</b>: the trips you are on, the predictions, comments, pies, reactions, and —
            for ranking what to show you — which prediction pages you opened and when.
          </li>
          <li>
            <b>Bills</b>: what members said they paid and owe, in the trip's currencies.
          </li>
          <li>
            <b>Kept phrases</b>: a line from the interpreter that a member deliberately named and
            saved, with the language it is in, for the whole trip to replay.
          </li>
          <li>
            <b>Server logs</b> with request metadata, kept for a short period for security and
            debugging.
          </li>
        </ul>
      </Section>

      <Section title="What we do not store">
        The interpreter keeps nothing: no audio, no transcript, no turn. A conversation lives in the
        browser tab and ends with it. Speech recognition happens on your device, through your
        browser's own recogniser; translation text is sent to a language-model provider for the
        duration of the request and is not retained by us. We run no third-party analytics, set no
        advertising cookies, and use only the cookies the app needs to sign you in.
      </Section>

      <Section title="Who can see it">
        Members of a trip see everything on that trip. Nobody outside it sees anything, with one
        exception: a verdict card a member chooses to share is a public page showing the question,
        the outcome, first names, and pies. Service providers who host the database and run the
        language model process data on our instructions only.
      </Section>

      <Section title="Lawful basis">
        Performing the service you asked for (the game, the bills, the interpreter); your consent
        for anything optional (a picture, a kept phrase, the lingo); and our legitimate interest in
        keeping the service secure and the ledger honest.
      </Section>

      <Section title="How long">
        As long as you have an account. When you delete it, your name, email, picture, passkeys,
        kept phrases, reactions, and page-view log are removed immediately. Your entries in a trip's
        ledger, bills, and comments stay, attributed to "Departed member", because each trip's
        accounting is append-only and removing a payout would change other members' numbers. That
        residue contains no identifier.
      </Section>

      <Section title="Your rights">
        Access, correction, erasure (above), portability, and the right to complain to the Data
        Protection Board of India or your local supervisory authority. You can exercise every one of
        them from your account page or by writing to us; we answer within 30 days.
      </Section>

      <Section title="Children">
        The app is for people 18 and over. We do not knowingly hold data about anyone younger, and
        delete an account when we learn otherwise.
      </Section>

      <Section title="Where the data lives">
        On servers we operate, currently in India, with backups in the same region. Language model
        and voice providers may process requests outside India; we send them the text of a request
        and nothing that identifies you.
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="display text-xl font-bold uppercase tracking-wide">{title}</h2>
      <div className="mt-1 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
