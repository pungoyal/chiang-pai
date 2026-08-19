import { redirect } from "next/navigation";
import { PasskeySignIn } from "@/components/passkey-sign-in";
import { SignedOutCard } from "@/components/signed-out-card";
import { createSession, getSession, googleConfigured } from "@/lib/auth";
import { ensureMember } from "@/lib/data";
import { env } from "@/lib/env";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getSession();
  if (session) redirect("/");
  const { error } = await searchParams;

  return (
    <SignedOutCard eyebrow="Who saw it coming?">
      <p className="mt-3 text-sm text-soft">
        A private prediction game. Virtual pies, real reputations.
      </p>

      {error === "AccessDenied" && (
        <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
          That Google account isn't on the list. This table is invite-only; ask a founding member to
          add you.
        </p>
      )}
      {error && error !== "AccessDenied" && (
        <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
          Sign-in failed. Try again.
        </p>
      )}

      <div className="mt-6">
        <PasskeySignIn />
      </div>

      {googleConfigured && (
        <>
          <p className="mt-4 text-xs uppercase tracking-wider text-soft">or</p>
          <a
            href="/api/auth/google"
            className="mt-2 block w-full rounded-md border border-line py-3 font-semibold hover:bg-paper"
          >
            Continue with Google
          </a>
        </>
      )}

      {env.AUTH_DEV_LOGIN && (
        <form
          className="mt-4 space-y-2 border-t border-line pt-4 text-left"
          action={async (formData: FormData) => {
            "use server";
            // Re-checked on the server: the flag is the only thing standing
            // between this form and a passwordless login in production.
            if (!env.AUTH_DEV_LOGIN) redirect("/signin");
            const email = String(formData.get("email") ?? "")
              .trim()
              .toLowerCase();
            if (!email.includes("@")) redirect("/signin?error=DevLogin");
            const name = String(formData.get("name") ?? "").trim() || email.split("@")[0];
            const member = await ensureMember(email, name, { bypassAllowlist: true });
            if (!member) redirect("/signin?error=DevLogin");
            await createSession(member.id);
            redirect("/");
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gold">
            Dev login — local only
          </p>
          <input
            name="email"
            type="email"
            required
            placeholder="you@example.com"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
          />
          <input
            name="name"
            type="text"
            placeholder="Display name"
            className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="w-full rounded-md border border-line py-2 text-sm font-semibold hover:bg-paper"
          >
            Sign in as this person
          </button>
        </form>
      )}

      {!googleConfigured && !env.AUTH_DEV_LOGIN && (
        <p className="mt-4 text-xs text-soft">
          Passkeys only — Google sign-in isn't configured here.
        </p>
      )}
    </SignedOutCard>
  );
}
