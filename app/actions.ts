"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  createSession,
  getSession,
  passkeysConfigured,
  RP_ID,
  RP_ORIGIN,
  startPasskeyChallenge,
  takePasskeyChallenge,
} from "@/lib/auth";
import {
  addBill,
  addComment,
  addCredential,
  type BillInput,
  clearAvatar,
  createMarket,
  DataError,
  deleteBill,
  editBill,
  findCredential,
  findInvite,
  getMember,
  joinWithInvite,
  listCredentials,
  mintInvite,
  noteCredentialUse,
  placeBet,
  type ReactionKind,
  recordMarketView,
  recordSettlement,
  removeCredential,
  replaceInvite,
  resolveMarket,
  revokeInvite,
  setAvatar,
  setLingo,
  setReaction,
  switchSides,
} from "@/lib/data";
import type { Member } from "@/lib/db/schema";
import type { Side } from "@/lib/engine";
import { hashInviteCode, inviteState } from "@/lib/invites";
import { isLingoKey, lingoOf } from "@/lib/lingo";
import { llmEnabled, type PolishedDraft, polishMarketDraft } from "@/lib/llm";
import { logger } from "@/lib/logger";
import type { Currency } from "@/lib/split";
import { ES256, RS256, verifyAssertion, verifyRegistration, WebAuthnError } from "@/lib/webauthn";

export interface ActionResult {
  ok: boolean;
  error?: string;
}

async function requireMemberId(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session.memberId;
}

function failure(err: unknown): ActionResult {
  if (err instanceof DataError) {
    // Expected rule violations (stake caps, closed markets, …), not faults.
    logger.debug({ reason: err.message }, "action rejected");
    return { ok: false, error: err.message };
  }
  logger.error({ err }, "action failed");
  return { ok: false, error: "Something went wrong. Try again." };
}

/**
 * Every mutation is the same shape: act as the signed-in member, turn a broken
 * rule into a message the panel can show, and revalidate what the write
 * changed. `run` returns whatever extra the caller needs on success.
 */
async function mutate<T extends object>(
  run: (memberId: string) => Promise<T>,
  paths: (result: T) => string[],
): Promise<ActionResult & Partial<T>> {
  const memberId = await requireMemberId();
  let result: T;
  try {
    result = await run(memberId);
  } catch (err) {
    // A failure carries no payload, which TypeScript can't know for a generic
    // T — hence the one cast.
    return failure(err) as ActionResult & Partial<T>;
  }
  for (const path of paths(result)) revalidatePath(path);
  return { ok: true, ...result };
}

export async function betAction(marketId: string, side: Side, pies: number): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await placeBet(memberId, marketId, side, pies);
      return {};
    },
    () => ["/", `/market/${marketId}`],
  );
}

export async function switchAction(marketId: string): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await switchSides(memberId, marketId);
      return {};
    },
    () => ["/", `/market/${marketId}`],
  );
}

export async function resolveAction(
  marketId: string,
  outcome: Side | "refunded",
  note: string,
): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await resolveMarket(marketId, memberId, outcome, note);
      return {};
    },
    () => ["/", `/market/${marketId}`, "/leaderboard"],
  );
}

export async function createMarketAction(
  question: string,
  criteria: string,
): Promise<ActionResult & { marketId?: string }> {
  return mutate(
    async (memberId) => ({ marketId: await createMarket(memberId, question, criteria) }),
    () => ["/"],
  );
}

export async function polishAction(
  question: string,
  criteria: string,
  feedback: string,
): Promise<ActionResult & { draft?: PolishedDraft }> {
  const memberId = await requireMemberId();
  if (!llmEnabled) return { ok: false, error: "The magic isn't switched on for this deploy." };
  if (!question.trim() && !criteria.trim()) {
    return {
      ok: false,
      error: "Write a rough draft first — the magic needs something to work with.",
    };
  }
  try {
    const member = await getMember(memberId);
    const register = lingoOf(member?.lingo ?? "english").register;
    const draft = await polishMarketDraft({ question, criteria }, feedback, register);
    return { ok: true, draft };
  } catch (err) {
    logger.error({ err }, "polish failed");
    return { ok: false, error: "The magic fizzled. Try again." };
  }
}

export async function setLingoAction(lingo: string): Promise<ActionResult> {
  const memberId = await requireMemberId();
  if (!isLingoKey(lingo)) return { ok: false, error: "Pick a lingo from the list." };
  await setLingo(memberId, lingo);
  // The lingo colors copy on every page, including the layout's footer.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setAvatarAction(formData: FormData): Promise<ActionResult> {
  const memberId = await requireMemberId();
  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Pick an image first." };
  }
  try {
    await setAvatar(memberId, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    return failure(err);
  }
  // The avatar shows in the header on every page.
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearAvatarAction(): Promise<ActionResult> {
  const memberId = await requireMemberId();
  try {
    await clearAvatar(memberId);
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Telemetry, not a mutation: log that the signed-in member opened a
 * prediction. Best-effort — a lost view must never break the page.
 */
export async function recordViewAction(marketId: string): Promise<void> {
  const session = await getSession();
  if (!session) return;
  try {
    await recordMarketView(session.memberId, marketId);
  } catch (err) {
    logger.debug({ err, marketId }, "view not recorded");
  }
}

export async function reactAction(
  marketId: string,
  kind: ReactionKind,
  on: boolean,
): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await setReaction(memberId, marketId, kind, on);
      return {};
    },
    () => ["/", `/market/${marketId}`],
  );
}

export async function addBillAction(input: BillInput): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await addBill(memberId, input);
      return {};
    },
    () => ["/bills"],
  );
}

export async function editBillAction(billId: string, input: BillInput): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await editBill(memberId, billId, input);
      return {};
    },
    () => ["/bills"],
  );
}

export async function deleteBillAction(billId: string): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await deleteBill(memberId, billId);
      return {};
    },
    () => ["/bills"],
  );
}

export async function settleUpAction(
  payerId: string,
  receiverId: string,
  currency: Currency,
  amountC: number,
  onDate: string,
): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await recordSettlement(memberId, { payerId, receiverId, currency, amountC, onDate });
      return {};
    },
    () => ["/bills"],
  );
}

export async function commentAction(
  target: { marketId?: string; billId?: string },
  body: string,
): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await addComment(memberId, target, body);
      return {};
    },
    () => (target.marketId ? [`/market/${target.marketId}`] : ["/bills"]),
  );
}

export async function mintInviteAction(
  label: string,
  opts?: { isOpen?: boolean },
): Promise<ActionResult & { code?: string }> {
  const memberId = await requireMemberId();
  try {
    const code = await mintInvite(memberId, label, opts);
    revalidatePath("/members");
    return { ok: true, code };
  } catch (err) {
    return failure(err);
  }
}

export async function replaceInviteAction(
  codeHash: string,
): Promise<ActionResult & { code?: string }> {
  const memberId = await requireMemberId();
  try {
    const code = await replaceInvite(memberId, codeHash);
    revalidatePath("/members");
    return { ok: true, code };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeInviteAction(codeHash: string): Promise<ActionResult> {
  return mutate(
    async (memberId) => {
      await revokeInvite(memberId, codeHash);
      return {};
    },
    () => ["/members"],
  );
}

// ---------- passkeys ----------
//
// Two round trips each way: the browser asks for a challenge, talks to the
// authenticator, and posts the result back. The challenge lives in a signed
// cookie between the two (lib/auth.ts); the checking is lib/webauthn.ts. Both
// finish actions are reachable by anyone who can POST, so every field they
// receive is treated as a string of unknown provenance.

const CEREMONY_TIMEOUT_MS = 120_000;

/** Said once, in both directions: the browser's own error for this is useless. */
const NOT_CONFIGURED =
  "Passkeys need this server to be reachable by hostname over HTTPS (or localhost) — " +
  "AUTH_URL is currently an IP address.";

/** Algorithms in the order we prefer them: ES256 first, RS256 for TPMs. */
const CREDENTIAL_PARAMS = [ES256, RS256].map((alg) => ({ type: "public-key" as const, alg }));

const registrationSchema = z.object({
  id: z.string().min(1).max(512),
  clientDataJSON: z.string().min(1).max(4096),
  attestationObject: z.string().min(1).max(16_384),
});

const assertionSchema = z.object({
  id: z.string().min(1).max(512),
  clientDataJSON: z.string().min(1).max(4096),
  authenticatorData: z.string().min(1).max(4096),
  signature: z.string().min(1).max(4096),
});

export interface PasskeyRegistrationOptions {
  /** Where the server expects the ceremony to happen; the client checks it matches. */
  origin: string;
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  excludeCredentials: { type: "public-key"; id: string }[];
  authenticatorSelection: {
    residentKey: "required";
    requireResidentKey: true;
    userVerification: "preferred";
  };
  attestation: "none";
  timeout: number;
}

export interface PasskeySignInOptions {
  origin: string;
  challenge: string;
  rpId: string;
  userVerification: "preferred";
  timeout: number;
}

/** Step one of adding a passkey, for a member who is already signed in. */
export async function beginPasskeyRegistrationAction(): Promise<
  ActionResult & { options?: PasskeyRegistrationOptions }
> {
  const memberId = await requireMemberId();
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  const member = await getMember(memberId);
  if (!member) redirect("/signin");

  const existing = await listCredentials(memberId);
  return {
    ok: true,
    options: {
      origin: RP_ORIGIN,
      challenge: await startPasskeyChallenge("register"),
      rp: { id: RP_ID, name: "Chiang Pai" },
      user: {
        // Opaque on purpose: the authenticator stores this, and a member id is
        // the least it can be given while still naming the right account.
        id: Buffer.from(memberId, "utf8").toString("base64url"),
        name: member.name,
        displayName: member.name,
      },
      pubKeyCredParams: CREDENTIAL_PARAMS,
      // Nothing is gained by letting one device enrol twice.
      excludeCredentials: existing.map((c) => ({ type: "public-key" as const, id: c.id })),
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      attestation: "none",
      timeout: CEREMONY_TIMEOUT_MS,
    },
  };
}

/** Step two: check what the authenticator produced and keep the public key. */
export async function finishPasskeyRegistrationAction(response: unknown): Promise<ActionResult> {
  const memberId = await requireMemberId();
  const parsed = registrationSchema.safeParse(response);
  const challenge = await takePasskeyChallenge("register");
  if (!parsed.success || !challenge) {
    logger.warn({ memberId }, "passkey registration: malformed response or expired challenge");
    return { ok: false, error: "That took too long. Try adding the passkey again." };
  }

  try {
    const verified = verifyRegistration(parsed.data, {
      rpId: RP_ID,
      origin: RP_ORIGIN,
      challenge: challenge.challenge,
    });
    if (await findCredential(verified.credentialId)) {
      return { ok: false, error: "That passkey is already on the list." };
    }
    await addCredential(memberId, verified);
  } catch (err) {
    if (err instanceof WebAuthnError) {
      logger.warn({ memberId, reason: err.message }, "passkey registration rejected");
      return { ok: false, error: "That passkey didn't check out. Try again." };
    }
    logger.error({ err, memberId }, "passkey registration failed");
    return { ok: false, error: "Something went wrong. Try again." };
  }

  revalidatePath(`/member/${memberId}`);
  revalidatePath("/members");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Step one of signing in. Deliberately unauthenticated, and deliberately
 * without an allowCredentials list: the browser offers whichever passkey it
 * holds for this site, so nobody types an identifier of any kind.
 */
export async function beginPasskeySignInAction(): Promise<
  ActionResult & { options?: PasskeySignInOptions }
> {
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  return {
    ok: true,
    options: {
      origin: RP_ORIGIN,
      challenge: await startPasskeyChallenge("login"),
      rpId: RP_ID,
      userVerification: "preferred",
      timeout: CEREMONY_TIMEOUT_MS,
    },
  };
}

/** Step two: the signature decides who this is. Redirects home on success. */
export async function finishPasskeySignInAction(response: unknown): Promise<ActionResult> {
  const parsed = assertionSchema.safeParse(response);
  const challenge = await takePasskeyChallenge("login");
  if (!parsed.success || !challenge) {
    logger.warn("passkey sign-in: malformed response or expired challenge");
    return { ok: false, error: "That took too long. Try signing in again." };
  }

  const credential = await findCredential(parsed.data.id);
  // One message for "no such credential" and "bad signature" alike: which of
  // the two it was is not something an unauthenticated caller should learn.
  const rejected = { ok: false, error: "That passkey didn't work. Try again." };
  if (!credential) {
    logger.warn("passkey sign-in: unknown credential");
    return rejected;
  }

  let memberId: string;
  try {
    const verified = verifyAssertion(
      parsed.data,
      { rpId: RP_ID, origin: RP_ORIGIN, challenge: challenge.challenge },
      credential,
    );
    const member = await getMember(credential.memberId);
    if (!member) {
      logger.warn({ memberId: credential.memberId }, "passkey sign-in: member is gone");
      return rejected;
    }
    await noteCredentialUse(credential.id, verified.signCount, verified.backedUp);
    memberId = member.id;
  } catch (err) {
    if (err instanceof WebAuthnError) {
      logger.warn({ reason: err.message }, "passkey sign-in rejected");
      return rejected;
    }
    logger.error({ err }, "passkey sign-in failed");
    return { ok: false, error: "Something went wrong. Try again." };
  }

  await createSession(memberId);
  logger.info({ memberId, provider: "passkey" }, "member signed in");
  redirect("/");
}

export async function removePasskeyAction(credentialId: string): Promise<ActionResult> {
  const memberId = await requireMemberId();
  await removeCredential(memberId, credentialId);
  revalidatePath(`/member/${memberId}`);
  revalidatePath("/members");
  return { ok: true };
}

// ---------- joining by invite link ----------
//
// The same two-step ceremony as adding a passkey, for someone who has no
// account yet. The member id is minted at step one and carried in the sealed
// challenge cookie, so the passkey and the member row agree on who this is
// before either exists. A separate challenge purpose keeps a join ceremony
// from being finished as an "add a passkey to my account" one.

const joinSchema = z.object({
  code: z.string().min(1).max(128),
  name: z.string().min(1).max(64),
  lingo: z.string().max(32).optional(),
  response: registrationSchema,
});

export async function beginJoinAction(
  code: string,
  name: string,
): Promise<ActionResult & { options?: PasskeyRegistrationOptions }> {
  if (!passkeysConfigured) return { ok: false, error: NOT_CONFIGURED };
  if (await getSession()) return { ok: false, error: "You're already signed in." };

  const invite = await findInvite(code);
  if (!invite || inviteState(invite, new Date()) !== "live") {
    return { ok: false, error: "That invite link has already been used or has expired." };
  }

  const memberId = randomUUID();
  const displayName = name.trim() || invite.label;
  return {
    ok: true,
    options: {
      origin: RP_ORIGIN,
      challenge: await startPasskeyChallenge("join", {
        memberId,
        codeHash: hashInviteCode(code),
      }),
      rp: { id: RP_ID, name: "Chiang Pai" },
      user: {
        id: Buffer.from(memberId, "utf8").toString("base64url"),
        name: displayName,
        displayName,
      },
      pubKeyCredParams: CREDENTIAL_PARAMS,
      excludeCredentials: [],
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "preferred",
      },
      attestation: "none",
      timeout: CEREMONY_TIMEOUT_MS,
    },
  };
}

/** Verify the new passkey, then create the member and spend the link together. */
export async function finishJoinAction(input: unknown): Promise<ActionResult> {
  const parsed = joinSchema.safeParse(input);
  const pending = await takePasskeyChallenge("join");
  if (!parsed.success || !pending?.memberId) {
    logger.warn("join: malformed response or expired challenge");
    return { ok: false, error: "That took too long. Open the link again." };
  }
  // The link finished with must be the one the ceremony started for.
  if (pending.codeHash !== hashInviteCode(parsed.data.code)) {
    logger.warn("join: challenge belongs to a different invite");
    return { ok: false, error: "That didn't work. Open the link again." };
  }

  let member: Member;
  try {
    const verified = verifyRegistration(parsed.data.response, {
      rpId: RP_ID,
      origin: RP_ORIGIN,
      challenge: pending.challenge,
    });
    member = await joinWithInvite({
      code: parsed.data.code,
      memberId: pending.memberId,
      name: parsed.data.name,
      // An unknown key would be a stale client; english is the baseline anyway.
      lingo: isLingoKey(parsed.data.lingo ?? "") ? parsed.data.lingo : undefined,
      credential: verified,
    });
  } catch (err) {
    if (err instanceof WebAuthnError) {
      logger.warn({ reason: err.message }, "join rejected");
      return { ok: false, error: "That passkey didn't check out. Try again." };
    }
    return failure(err);
  }

  await createSession(member.id);
  logger.info({ memberId: member.id }, "member signed in");
  redirect("/");
}
