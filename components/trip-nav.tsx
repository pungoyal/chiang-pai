"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { routes } from "@/lib/routes";

/**
 * The tabs of one trip. Client-side only for the active underline — the
 * pathname is the one thing the server doesn't hand a layout.
 */
export function TripNav({
  tripId,
  unread,
  talkLabel,
  ended,
}: {
  tripId: string;
  unread: boolean;
  /** The local language, or null when there is nothing to interpret. */
  talkLabel: string | null;
  /** Past the last day: the recap tab comes forward. */
  ended: boolean;
}) {
  const pathname = usePathname();
  const tabs: { href: string; label: string; dot?: boolean; exact?: boolean }[] = [
    { href: routes.trip(tripId), label: "Calls", exact: true },
    { href: routes.members(tripId), label: "Table" },
    { href: routes.bills(tripId), label: "Bills" },
  ];
  if (talkLabel) tabs.push({ href: routes.talk(tripId), label: talkLabel });
  tabs.push({ href: routes.recap(tripId), label: ended ? "Recap ★" : "Recap" });
  tabs.push({ href: routes.inbox(tripId), label: "Inbox", dot: unread });

  return (
    <nav className="-mx-4 mt-3 flex gap-1 overflow-x-auto border-b border-line px-4 text-sm">
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative whitespace-nowrap px-3 py-2 font-semibold ${
              active ? "border-b-[3px] border-felt text-ink" : "text-soft hover:text-ink"
            }`}
          >
            {tab.label}
            {tab.dot && (
              <span
                className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-no"
                title="Unread activity"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
