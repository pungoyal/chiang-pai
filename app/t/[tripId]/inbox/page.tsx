import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { EmptyState, tone } from "@/components/ui";
import { type InboxItem, inbox, markInboxSeen } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { type Lingo, lingoOf } from "@/lib/lingo";
import { piesText } from "@/lib/pies";
import { routes } from "@/lib/routes";
import { requireTrip } from "@/lib/session";

export default async function InboxPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const { me } = await requireTrip(tripId);
  const t = lingoOf(me.lingo);
  const { items } = await inbox(tripId, me.id);
  // Everything on screen is now seen; the unread highlights below still show
  // this one time because they were computed before the cursor moved.
  await markInboxSeen(tripId, me.id);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="display text-4xl font-extrabold uppercase tracking-wide">Inbox</h1>
      <p className="mt-1 text-sm text-soft">{t.inboxSub}</p>

      {items.length === 0 ? (
        <div className="mt-5">
          <EmptyState title={t.inboxEmptyTitle} sub={t.inboxEmptySub} />
        </div>
      ) : (
        <ul className="mt-5 card list">
          {items.map((item) => (
            <Item key={itemKey(item)} item={item} t={t} tripId={tripId} />
          ))}
        </ul>
      )}
    </div>
  );
}

function itemKey(item: InboxItem): string {
  if (item.kind === "activity") return `a-${item.row.id}`;
  if (item.kind === "comment" || item.kind === "mention") return `c-${item.commentId}`;
  return `${item.kind}-${item.market.id}`;
}

/** Bill talk lands on /bills; everything else has a prediction page. */
function itemHref(tripId: string, item: InboxItem): string {
  return item.market ? routes.market(tripId, item.market.id) : routes.bills(tripId);
}

function itemSubject(item: InboxItem): string {
  if (item.kind === "mention" || item.kind === "comment")
    return item.market?.question ?? item.bill?.label ?? "";
  return item.market.question;
}

function Item({ item, t, tripId }: { item: InboxItem; t: Lingo; tripId: string }) {
  return (
    <li className={item.unread ? "bg-felt-tint/40" : undefined}>
      <Link
        href={itemHref(tripId, item)}
        className="flex items-start gap-3 px-4 py-3 hover:bg-paper/60"
      >
        <span className="mt-0.5">
          <Avatar member={item.actor} size={26} />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <Line item={item} t={t} />
          {(item.kind === "comment" || item.kind === "mention") && (
            <span className="mt-0.5 block truncate text-xs">“{item.body}”</span>
          )}
          <span className="mt-0.5 block truncate text-xs text-soft">{itemSubject(item)}</span>
        </span>
        <span className="flex items-center gap-2 whitespace-nowrap text-xs text-soft">
          {item.unread && <span className="h-2 w-2 rounded-full bg-felt" title="Unread" />}
          {timeAgo(item.at)}
        </span>
      </Link>
    </li>
  );
}

function Line({ item, t }: { item: InboxItem; t: Lingo }) {
  const name = <span className="font-semibold">{item.actor.name}</span>;
  switch (item.kind) {
    case "new_market":
      return <>{name} opened a new prediction</>;
    case "comment":
      return (
        <>
          {name} commented{item.bill ? " on a bill" : ""}
        </>
      );
    case "mention":
      return (
        <>
          {name} tagged you{item.bill ? " on a bill" : ""}
        </>
      );
    case "activity":
      return (
        <>
          {name}{" "}
          {item.row.kind === "switch"
            ? `switched to ${item.row.side?.toUpperCase()}`
            : `put ${piesText(item.row.amountC)} on ${item.row.side?.toUpperCase()}`}
        </>
      );
    case "resolved":
      return (
        <>
          {name}{" "}
          {item.market.status === "refunded"
            ? "voided it"
            : `resolved it ${item.market.status.toUpperCase()}`}
          {item.myProfitC !== null && (
            <span className={`mono ml-1.5 font-bold ${tone(item.myProfitC)}`}>
              {item.myProfitC === 0
                ? "(pies returned)"
                : `(${(item.myProfitC > 0 ? t.youWon : t.youLost)(
                    `${piesText(Math.abs(item.myProfitC))}`,
                  )})`}
            </span>
          )}
        </>
      );
  }
}
