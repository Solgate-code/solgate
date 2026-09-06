import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import bs58 from "bs58";

// noble-ed25519 v2 needs a sync sha512 for verify()
(ed.etc as { sha512Sync?: (...m: Uint8Array[]) => Uint8Array }).sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const enc = new TextEncoder();
export const toHex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
export const sha256Hex = (s: string) => toHex(sha256(enc.encode(s)));
export const hmacHex = (secret: string, data: string) => toHex(hmac(sha256, enc.encode(secret), enc.encode(data)));

export function randomId(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return toHex(b);
}

export function base64url(u: Uint8Array | string) {
  const bytes = typeof u === "string" ? enc.encode(u) : u;
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** Verify an ed25519 signature over a UTF-8 message from a base58 Solana pubkey. Signature may be base58 or base64. */
export function verifyWalletSignature(wallet: string, message: string, signature: string): boolean {
  try {
    const pub = bs58.decode(wallet);
    let sig: Uint8Array;
    try {
      sig = bs58.decode(signature);
      if (sig.length !== 64) throw new Error();
    } catch {
      sig = fromBase64url(signature);
    }
    return ed.verify(sig, enc.encode(message), pub);
  } catch {
    return false;
  }
}

/* Session tokens: compact HMAC-signed JSON (no external JWT lib, edge-safe). */
export interface SessionPayload {
  wallet: string;
  campaignId: string;
  exp: number;
}
export function signSession(secret: string, p: SessionPayload) {
  const body = base64url(JSON.stringify(p));
  return `${body}.${hmacHex(secret, body)}`;
}
export function verifySession(secret: string, token: string): SessionPayload | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  if (!safeEqual(hmacHex(secret, body), mac)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as SessionPayload;
    if (p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/** PKCE helpers */
export function pkceVerifier() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export function pkceChallenge(verifier: string) {
  return base64url(sha256(enc.encode(verifier)));
}

/** Timing-safe string compare. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
