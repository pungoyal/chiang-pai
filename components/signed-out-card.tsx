import Link from "next/link";
import { Logo } from "@/components/logo";
import { routes } from "@/lib/routes";

/** The card every signed-out page is: sign in, join by invite, recover a seat. */
export function SignedOutCard({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto mt-10 max-w-sm overflow-hidden card text-center shadow-[0_2px_0_rgba(33,38,31,0.08)]">
      <div aria-hidden className="zari" />
      <div className="p-8">
        <Logo size={64} className="mx-auto rounded-2xl" />
        <p className="eyebrow mt-5">{eyebrow}</p>
        <p className="display mt-1 text-5xl font-extrabold uppercase leading-none tracking-wide">
          Chiang
          <br />
          Pai
        </p>
        {children}
      </div>
    </div>
  );
}

/** A link that leads nowhere — spent, expired, or meant for somebody else. */
export function SignedOutNotice({
  eyebrow,
  children,
}: {
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <SignedOutCard eyebrow={eyebrow}>
      <p className="mt-4 rounded-md bg-no-tint px-3 py-2 text-sm font-semibold text-no-deep">
        {children}
      </p>
      <Link
        href={routes.home}
        className="mt-3 block text-sm font-semibold text-felt hover:underline"
      >
        Go home →
      </Link>
    </SignedOutCard>
  );
}
