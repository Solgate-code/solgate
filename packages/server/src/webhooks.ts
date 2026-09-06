import type { AllowlistEvent, AllowlistEventType } from "@solgate/core";
import type { Storage } from "./storage/types.js";
import { hmacHex, randomId, safeEqual } from "./crypto.js";

/**
 * Webhook dispatcher. Payloads are signed with HMAC-SHA256 over
 * `${timestamp}.${body}` in the `X-Allowlist-Signature` header
 * ("t=<ts>,v1=<hex>"), so receivers can verify + reject replays.
 */
export class EventBus {
  private listeners: ((e: AllowlistEvent) => void | Promise<void>)[] = [];
  constructor(private storage: Storage, private waitUntil?: (p: Promise<unknown>) => void) {}

  on(fn: (e: AllowlistEvent) => void | Promise<void>) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  async emit<T>(type: AllowlistEventType, campaignId: string, data: T, wallet?: string) {
    const event: AllowlistEvent<T> = { id: randomId(12), type, campaignId, wallet, data, createdAt: Date.now() };
    for (const l of this.listeners) await l(event);
    const p = this.dispatch(event);
    this.waitUntil ? this.waitUntil(p) : p.catch(() => {});
    return event;
  }

  private async dispatch(event: AllowlistEvent) {
    const hooks = (await this.storage.listWebhooks()).filter(
      (h) => h.active && (!h.campaignId || h.campaignId === event.campaignId) && (h.events.includes("*") || h.events.includes(event.type)),
    );
    await Promise.all(hooks.map((h) => this.deliver(h.id, h.url, h.secret, event)));
  }

  async deliver(webhookId: string, url: string, secret: string, event: AllowlistEvent, maxAttempts = 3) {
    const body = JSON.stringify(event);
    let status = 0;
    let lastError: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ts = Math.floor(Date.now() / 1000);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-allowlist-event": event.type,
            "x-allowlist-delivery": event.id,
            "x-allowlist-signature": `t=${ts},v1=${hmacHex(secret, `${ts}.${body}`)}`,
          },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        status = r.status;
        if (r.ok) break;
        lastError = `HTTP ${r.status}`;
      } catch (e) {
        lastError = (e as Error).message;
      }
      await new Promise((res) => setTimeout(res, 500 * 2 ** attempt));
      if (attempt === maxAttempts) {
        await this.storage.putDelivery({ id: randomId(8), webhookId, eventId: event.id, status, attempts: attempt, lastError, createdAt: Date.now() });
        return;
      }
    }
    await this.storage.putDelivery({ id: randomId(8), webhookId, eventId: event.id, status, attempts: 1, lastError, createdAt: Date.now() });
  }
}

/** Helper for receivers (Next.js API route, Express, etc). */
export function verifyWebhookSignature(secret: string, header: string, body: string, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const ts = Number(parts.t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  return safeEqual(hmacHex(secret, `${ts}.${body}`), parts.v1 ?? "");
}

/**
 * Reject webhook targets that could reach internal infrastructure (SSRF).
 * Blocks non-HTTPS (unless `allowHttp`), localhost, link-local/metadata and
 * RFC1918 literals. Hostnames that *resolve* to private IPs are not caught
 * here — put the API behind an egress policy for that.
 */
export function assertSafeWebhookUrl(raw: string, opts: { allowInsecure?: boolean } = {}) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (opts.allowInsecure && (u.protocol === "http:" || u.protocol === "https:")) return u; // development only
  if (u.protocol !== "https:") throw new Error("Webhook URL must use https");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h === "0.0.0.0" || h === "::1" || h === "::") throw new Error("Webhook URL may not target localhost");
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))
      throw new Error("Webhook URL may not target a private network");
  }
  if (/^(fc|fd|fe80)/i.test(h)) throw new Error("Webhook URL may not target a private network");
  return u;
}
