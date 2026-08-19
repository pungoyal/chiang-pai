import { Logo } from "@/components/logo";

/** The card the two signed-out pages are: sign in, and join by invite. */
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
