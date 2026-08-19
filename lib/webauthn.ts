// Passkey (WebAuthn) verification, implemented directly on node:crypto — no
// auth library, in the spirit of lib/auth.ts.
//
// A passkey is a keypair the member's device holds. Registration hands us a
// public key; every sign-in hands us a signature over
// `authenticatorData ‖ sha256(clientDataJSON)`, which we check against that
// stored key. Nothing identifying is involved at any point: what we keep is a
// random credential id, a public key, and a counter.
//
// Attestation is deliberately not verified. It would tell us which make and
// model of authenticator a member used, which is exactly the kind of fact this
// app has no business storing — and it proves nothing we need, since trust
// comes from the invite that let them register, not from their hardware. We
// ask the browser for `attestation: "none"` and ignore the statement.
//
// This module is pure: no env, no database, no cookies. The caller supplies
// what it expects (rp id, origin, the challenge it issued, the stored
// credential) and gets back a verified result or a WebAuthnError.

import { createHash, createPublicKey, type KeyObject, verify } from "node:crypto";
import { type CborMap, type CborValue, decodeCbor, decodeCborAt } from "./cbor.ts";

export class WebAuthnError extends Error {}

/** COSE algorithm ids. ES256 is what phones and laptops use; RS256 is TPMs. */
export const ES256 = -7;
export const RS256 = -257;
export const SUPPORTED_ALGS: readonly number[] = [ES256, RS256];

// Authenticator data flag bits (WebAuthn §6.1).
const FLAG_UP = 0x01; // user present — someone touched the thing
const FLAG_UV = 0x04; // user verified — biometric or PIN
const FLAG_BS = 0x10; // backup state — the key is synced to a credential manager
const FLAG_AT = 0x40; // attested credential data follows
const FLAG_ED = 0x80; // extension data follows

// --- wire shapes --------------------------------------------------------------
// What the browser's PublicKeyCredential is flattened into before it crosses
// the server-action boundary; every binary field is base64url.

export interface RegistrationResponse {
  id: string;
  clientDataJSON: string;
  attestationObject: string;
}

export interface AssertionResponse {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

/** What the server knows it asked for, checked against what came back. */
export interface Expectations {
  /** The registrable domain the credential is scoped to (no scheme, no port). */
  rpId: string;
  /** Exact origin string, e.g. "https://chiang.example" or "http://localhost:3000". */
  origin: string;
  /** The base64url challenge this server issued, as issued. */
  challenge: string;
}

export interface StoredCredential {
  /** SPKI DER, as returned by verifyRegistration. */
  publicKey: Buffer;
  alg: number;
  signCount: number;
}

export interface VerifiedRegistration {
  credentialId: string;
  publicKey: Buffer;
  alg: number;
  signCount: number;
  /** The authenticator syncs this key to a credential manager (iCloud, etc). */
  backedUp: boolean;
  userVerified: boolean;
}

export interface VerifiedAssertion {
  signCount: number;
  backedUp: boolean;
  userVerified: boolean;
}

export interface AuthenticatorData {
  rpIdHash: Buffer;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  backedUp: boolean;
  signCount: number;
  /** Present only on registration, where FLAG_AT is set. */
  credentialId: Buffer | null;
  coseKey: CborMap | null;
}

// --- registration -------------------------------------------------------------

/**
 * Check a `navigator.credentials.create()` result and return the credential to
 * store. Throws WebAuthnError on anything that doesn't line up — the caller
 * logs the reason and tells the member only that it didn't work.
 */
export function verifyRegistration(
  response: RegistrationResponse,
  expected: Expectations,
): VerifiedRegistration {
  checkClientData(response.clientDataJSON, "webauthn.create", expected);

  const attestation = decodeCbor(fromBase64url(response.attestationObject, "attestationObject"));
  if (!(attestation instanceof Map)) {
    throw new WebAuthnError("attestation object is not a CBOR map");
  }
  const rawAuthData = attestation.get("authData");
  if (!Buffer.isBuffer(rawAuthData)) {
    throw new WebAuthnError("attestation object carries no authenticator data");
  }

  const auth = parseAuthenticatorData(rawAuthData);
  checkRpIdHash(auth, expected.rpId);
  if (!auth.userPresent) throw new WebAuthnError("the authenticator reported no user presence");
  if (!auth.credentialId || !auth.coseKey) {
    throw new WebAuthnError("registration carried no credential");
  }

  // The id the browser reports and the one the authenticator signed must agree,
  // or we would file the key under a name it does not answer to.
  const credentialId = auth.credentialId.toString("base64url");
  if (credentialId !== response.id) {
    throw new WebAuthnError("credential id does not match the attested one");
  }

  const { key, alg } = coseToPublicKey(auth.coseKey);
  return {
    credentialId,
    publicKey: key.export({ type: "spki", format: "der" }),
    alg,
    signCount: auth.signCount,
    backedUp: auth.backedUp,
    userVerified: auth.userVerified,
  };
}

// --- assertion ----------------------------------------------------------------

/**
 * Check a `navigator.credentials.get()` result against the stored credential.
 * The caller has already looked the credential up by `response.id`, which is
 * what makes this usernameless: the member types nothing at all.
 */
export function verifyAssertion(
  response: AssertionResponse,
  expected: Expectations,
  stored: StoredCredential,
): VerifiedAssertion {
  if (!SUPPORTED_ALGS.includes(stored.alg)) {
    throw new WebAuthnError(`stored credential uses unsupported algorithm ${stored.alg}`);
  }
  const clientDataBytes = checkClientData(response.clientDataJSON, "webauthn.get", expected);

  const authDataBytes = fromBase64url(response.authenticatorData, "authenticatorData");
  const auth = parseAuthenticatorData(authDataBytes);
  checkRpIdHash(auth, expected.rpId);
  if (!auth.userPresent) throw new WebAuthnError("the authenticator reported no user presence");

  const signed = Buffer.concat([authDataBytes, sha256(clientDataBytes)]);
  const signature = fromBase64url(response.signature, "signature");
  const key = publicKeyFromDer(stored.publicKey);
  let ok: boolean;
  try {
    // The key type picks the scheme: ECDSA/SHA-256 for ES256 (DER-encoded
    // signature, which is what authenticators emit), PKCS#1 v1.5 for RS256.
    ok = verify("sha256", signed, key, signature);
  } catch {
    // Malformed signature bytes make node throw rather than return false.
    ok = false;
  }
  if (!ok) throw new WebAuthnError("signature did not verify");

  // Counters are optional: authenticators that don't keep one report 0 forever,
  // and this check stays dormant. One that does keep a counter and goes
  // backwards has been cloned, which is worth refusing over.
  if (stored.signCount > 0 && auth.signCount <= stored.signCount) {
    throw new WebAuthnError("sign count went backwards — the credential may have been cloned");
  }

  return {
    signCount: auth.signCount,
    backedUp: auth.backedUp,
    userVerified: auth.userVerified,
  };
}

// --- pieces -------------------------------------------------------------------

/** Authenticator data: a fixed 37-byte header, then the new credential on registration. */
export function parseAuthenticatorData(data: Buffer): AuthenticatorData {
  if (data.length < 37) throw new WebAuthnError("authenticator data is too short");
  const flags = data[32];
  let offset = 37;

  let credentialId: Buffer | null = null;
  let coseKey: CborMap | null = null;
  if (flags & FLAG_AT) {
    // 16 bytes of aaguid — the authenticator's make and model. Skipped on
    // purpose: see the note on attestation at the top of this file.
    if (data.length < offset + 18) throw new WebAuthnError("attested credential data is truncated");
    offset += 16;
    const idLength = data.readUInt16BE(offset);
    offset += 2;
    if (idLength === 0 || idLength > 1023) throw new WebAuthnError("implausible credential id");
    if (data.length < offset + idLength) throw new WebAuthnError("credential id is truncated");
    credentialId = data.subarray(offset, offset + idLength);
    offset += idLength;

    const key = decodeCborAtChecked(data, offset);
    coseKey = key.value;
    offset = key.offset;
  }

  // We request no extensions, so nothing should follow. If an authenticator
  // sends some anyway it says so in the flags, and the bytes are ignored.
  if (!(flags & FLAG_ED) && offset !== data.length) {
    throw new WebAuthnError("trailing bytes after authenticator data");
  }

  return {
    rpIdHash: data.subarray(0, 32),
    flags,
    userPresent: (flags & FLAG_UP) !== 0,
    userVerified: (flags & FLAG_UV) !== 0,
    backedUp: (flags & FLAG_BS) !== 0,
    signCount: data.readUInt32BE(33),
    credentialId,
    coseKey,
  };
}

/** Turn the COSE key from an authenticator into something node can verify with. */
export function coseToPublicKey(cose: CborMap): { key: KeyObject; alg: number } {
  const kty = intField(cose, 1, "kty");
  const alg = intField(cose, 3, "alg");

  if (alg === ES256) {
    if (kty !== 2) throw new WebAuthnError("ES256 key is not an EC2 key");
    if (intField(cose, -1, "crv") !== 1)
      throw new WebAuthnError("only the P-256 curve is supported");
    const x = bytesField(cose, -2, "x");
    const y = bytesField(cose, -3, "y");
    if (x.length !== 32 || y.length !== 32)
      throw new WebAuthnError("P-256 coordinates are not 32 bytes");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "EC", crv: "P-256", x: x.toString("base64url"), y: y.toString("base64url") },
        format: "jwk",
      }),
    };
  }

  if (alg === RS256) {
    if (kty !== 3) throw new WebAuthnError("RS256 key is not an RSA key");
    const n = trimLeadingZeros(bytesField(cose, -1, "n"));
    const e = trimLeadingZeros(bytesField(cose, -2, "e"));
    if (n.length < 128) throw new WebAuthnError("RSA modulus is too small");
    return {
      alg,
      key: createPublicKey({
        key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") },
        format: "jwk",
      }),
    };
  }

  throw new WebAuthnError(`unsupported key algorithm ${alg}`);
}

/**
 * Parse and check clientDataJSON, returning its raw bytes — the signature is
 * over a hash of exactly those bytes, so they can't be re-serialized.
 */
function checkClientData(encoded: string, type: string, expected: Expectations): Buffer {
  const raw = fromBase64url(encoded, "clientDataJSON");
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    throw new WebAuthnError("client data is not valid JSON");
  }

  if (data.type !== type) throw new WebAuthnError(`client data is for ${String(data.type)}`);
  if (typeof data.challenge !== "string" || data.challenge !== expected.challenge) {
    throw new WebAuthnError("challenge does not match the one we issued");
  }
  if (data.origin !== expected.origin) {
    throw new WebAuthnError(`client data origin ${String(data.origin)} is not ours`);
  }
  // A credential used from inside someone else's iframe is not a sign-in we asked for.
  if (data.crossOrigin === true) throw new WebAuthnError("credential was used cross-origin");
  return raw;
}

function checkRpIdHash(auth: AuthenticatorData, rpId: string): void {
  if (!auth.rpIdHash.equals(sha256(Buffer.from(rpId, "utf8")))) {
    throw new WebAuthnError("credential belongs to a different relying party");
  }
}

/** The COSE key sits mid-buffer with no length prefix, hence the offset-aware read. */
function decodeCborAtChecked(data: Buffer, offset: number): { value: CborMap; offset: number } {
  const decoded = decodeCborAt(data, offset);
  if (!(decoded.value instanceof Map)) {
    throw new WebAuthnError("credential public key is not a CBOR map");
  }
  return { value: decoded.value, offset: decoded.offset };
}

function intField(cose: CborMap, label: number, name: string): number {
  const value = cose.get(label);
  if (typeof value !== "number") throw new WebAuthnError(`COSE key has no ${name}`);
  return value;
}

function bytesField(cose: CborMap, label: number, name: string): Buffer {
  const value: CborValue | undefined = cose.get(label);
  if (!Buffer.isBuffer(value)) throw new WebAuthnError(`COSE key has no ${name}`);
  return value;
}

function publicKeyFromDer(der: Buffer): KeyObject {
  try {
    return createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new WebAuthnError("stored public key is unreadable");
  }
}

function trimLeadingZeros(buf: Buffer): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0) start++;
  return buf.subarray(start);
}

function sha256(data: Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/**
 * Strict base64url: node's decoder silently ignores characters it doesn't
 * recognise, which would let two different strings name the same credential.
 */
function fromBase64url(value: string, field: string): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new WebAuthnError(`${field} is not base64url`);
  }
  return Buffer.from(value, "base64url");
}
