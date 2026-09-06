import type { AllowlistEvent, AllowlistEventType } from "@solana-allowlist/core";
import type { Storage } from "./storage/types.js";
import { hmacHex, randomId } from "./crypto.js";

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
  return hmacHex(secret, `${ts}.${body}`) === parts.v1;
}
