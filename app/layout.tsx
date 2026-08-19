import type { Metadata } from "next";
import { Big_Shoulders, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/avatar";
import { Logo } from "@/components/logo";
import { PasskeyNudge } from "@/components/passkey-nudge";
import { Pies } from "@/components/pies";
import { ThemeToggle } from "@/components/theme-toggle";
import { destroySession, getSession, passkeysConfigured } from "@/lib/auth";
import { getMember, hasPasskey, inbox, netOf } from "@/lib/data";
import { lingoOf } from "@/lib/lingo";
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
  title: "Chiang Pai",
  description: "A private prediction game for friends. Zero-sum, all bragging rights.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const member = session ? await getMember(session.memberId) : null;
  const netC = member ? await netOf(member.id) : 0;
  const hasUnread = member ? (await inbox(member.id)).unreadCount > 0 : false;
  const needsPasskey = passkeysConfigured && member ? !(await hasPasskey(member.id)) : false;
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
            <Link href="/" className="flex items-center gap-2.5">
              <Logo size={30} className="rounded-[22%] ring-1 ring-white/20" />
              <span className="display text-2xl font-extrabold uppercase tracking-wide">
                Chiang&nbsp;Pai
              </span>
            </Link>
            {member && (
              <nav className="order-last -mx-4 flex w-screen items-center gap-1 overflow-x-auto px-4 text-sm sm:order-none sm:mx-0 sm:w-auto sm:px-0">
                <Link href="/" className="rounded px-2 py-1 hover:bg-white/10">
                  Predictions
                </Link>
                <Link href="/leaderboard" className="rounded px-2 py-1 hover:bg-white/10">
                  Leaderboard
                </Link>
                <Link href="/members" className="rounded px-2 py-1 hover:bg-white/10">
                  Members
                </Link>
                <Link href="/bills" className="rounded px-2 py-1 hover:bg-white/10">
                  Bills
                </Link>
                <Link href="/inbox" className="relative rounded px-2 py-1 hover:bg-white/10">
                  Inbox
                  {hasUnread && (
                    <span
                      className="absolute right-0 top-0.5 h-2 w-2 rounded-full bg-no"
                      title="Unread activity"
                    />
                  )}
                </Link>
              </nav>
            )}
            <div className="ml-auto flex items-center gap-3">
              {member && (
                <>
                  <Link
                    href={`/member/${member.id}`}
                    className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-3 pr-1 hover:bg-white/20"
                    title="Your net and history"
                  >
                    <span className="mono text-sm font-semibold text-[#e8c46a]">
                      <Pies c={netC} sign />
                    </span>
                    <Avatar member={member} size={26} />
                  </Link>
                  <form
                    action={async () => {
                      "use server";
                      await destroySession();
                      redirect("/signin");
                    }}
                  >
                    <button
                      type="submit"
                      className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      title="Sign out"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              )}
              <ThemeToggle />
            </div>
          </div>
        </header>
        <div aria-hidden className="zari" />
        {member && needsPasskey && (
          <PasskeyNudge memberId={member.id} needsPicture={member.avatarUpdatedAt == null} />
        )}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 pb-8 pt-4 text-xs text-soft">{t.footer}</footer>
      </body>
    </html>
  );
}
