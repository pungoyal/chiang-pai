import { redirect } from "next/navigation";
import { getSession } from "./auth.ts";
import { getMember, type TripContext, tripFor } from "./data.ts";
import type { Member } from "./db/schema.ts";

/** For pages: the signed-in member, or a redirect to /signin. */
export async function requireMember(): Promise<Member> {
  const session = await getSession();
  if (!session) redirect("/signin");
  const member = await getMember(session.memberId);
  if (!member) redirect("/signin");
  return member;
}

/** The signed-in member, or null — for pages that have a signed-out face. */
export async function currentMember(): Promise<Member | null> {
  const session = await getSession();
  if (!session) return null;
  return getMember(session.memberId);
}

/**
 * For trip pages: the signed-in member and their seat on this trip, or a
 * redirect — to sign-in if nobody is, to the trips list if they have no seat.
 * Every page under /t/[tripId] starts here, so a URL alone opens nothing.
 */
export async function requireTrip(tripId: string): Promise<TripContext & { me: Member }> {
  const me = await requireMember();
  const ctx = await tripFor(me.id, tripId);
  if (!ctx) redirect("/trips");
  return { me, ...ctx };
}
