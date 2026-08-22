import type { Metadata, Viewport } from "next";
import { Big_Shoulders, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { signOutAction } from "@/app/actions";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/logo";
import { PasskeyNudge } from "@/components/passkey-nudge";
import { TermsNudge } from "@/components/terms-nudge";
import { ThemeToggle } from "@/components/theme-toggle";
import { passkeysConfigured } from "@/lib/auth";
import { anyUnread, hasPasskey } from "@/lib/data";
import { lingoOf } from "@/lib/lingo";
import { routes } from "@/lib/routes";
import { currentMember } from "@/lib/session";
import "./globals.css";

const display = Big_Shoulders({
  subsets: ["latin"],
  variable: "--font-big-shoulders",
});
const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});
const mono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
});

export const metadata: Metadata = {
  title: { default: "Chiang Pai", template: "%s · Chiang Pai" },
  description:
    "The app for the trip that actually happens. Call who shows up, who's late, who pays — play-money pies, real bragging rights.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Chiang Pai", statusBarStyle: "black-translucent" },
  openGraph: {
    siteName: "Chiang Pai",
    title: "Chiang Pai",
    description: "The app for the trip that actually happens.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#143024",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const member = await currentMember();
  // Independent of each other, so they go together rather than one at a time.
  const [unread, enrolled] = member
    ? await Promise.all([anyUnread(member.id), hasPasskey(member.id)])
    : [false, true];
  const needsPasskey = passkeysConfigured && member != null && !enrolled;
  const needsTerms = member != null && member.termsAcceptedAt == null;
  const t = lingoOf(member?.lingo ?? "english");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before first paint (system preference is
            pure CSS); suppressHydrationWarning covers the attribute change. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${display.variable} ${body.variable} ${mono.variable} min-h-screen antialiased`}
      >
        <header className="bg-felt-deep text-[#f1eee4]">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
            <Link href={member ? routes.trips : routes.home} className="flex items-center gap-2.5">
              <Logo size={30} className="rounded-[22%] ring-1 ring-white/20" />
              <span className="display text-2xl font-extrabold uppercase tracking-wide">
                Chiang&nbsp;Pai
              </span>
            </Link>
            <div className="ml-auto flex items-center gap-3">
              {member ? (
                <>
                  <Link
                    href={routes.trips}
                    className="relative rounded px-2 py-1 text-sm hover:bg-white/10"
                  >
                    Trips
                    {unread && (
                      <span
                        className="absolute right-0 top-0.5 h-2 w-2 rounded-full bg-no"
                        title="Unread activity"
                      />
                    )}
                  </Link>
                  <Link
                    href={routes.account}
                    className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-3 pr-1 hover:bg-white/20"
                    title="Your account"
                  >
                    <span className="text-sm">{member.name}</span>
                    <Avatar member={member} size={26} />
                  </Link>
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      title="Sign out"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                <Link href={routes.signin} className="rounded px-2 py-1 text-sm hover:bg-white/10">
                  Sign in
                </Link>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div aria-hidden className="zari" />
        {member && needsTerms && <TermsNudge />}
        {member && needsPasskey && !needsTerms && (
          <PasskeyNudge memberId={member.id} needsPicture={member.avatarUpdatedAt == null} />
        )}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-8 pt-4 text-xs text-soft">
          <span>{t.footer}</span>
          <span className="ml-auto flex gap-3">
            <Link href={routes.terms} className="hover:underline">
              Terms
            </Link>
            <Link href={routes.privacy} className="hover:underline">
              Privacy
            </Link>
          </span>
        </footer>
      </body>
    </html>
  );
}
