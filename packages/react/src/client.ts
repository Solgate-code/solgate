import type { Entry, RequirementResult } from "@solana-allowlist/core";

export interface PublicRequirement {
  key: string;
  module: string;
  config: any;
  required: boolean;
  points: number;
  title?: string;
  description?: string;
  category: "onchain" | "social" | "input" | "custom";
  label: string;
}
export interface PublicCampaign {
  id: string;
  name: string;
  description?: string;
  type: string;
  startsAt?: string;
  endsAt?: string;
  maxEntries?: number;
  minPoints: number;
  requirements: PublicRequirement[];
  allocation: { mode: string; tiers: { minPoints: number; allocation: number; label?: string }[] };
  metadata: Record<string, unknown>;
}

export class AllowlistApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Tiny fetch wrapper for the allowlist API. Works in any framework (or none). */
export class AllowlistClient {
  token: string | null;
  constructor(public baseUrl: string, public campaignId: string, private storageKey = `allowlist:${campaignId}`) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(this.storageKey) : null;
  }
  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(init.headers ?? {}) },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new AllowlistApiError(r.status, body.error ?? "error", body.message ?? r.statusText);
    return body as T;
  }
  setToken(t: string | null) {
    this.token = t;
    if (typeof sessionStorage === "undefined") return;
    t ? sessionStorage.setItem(this.storageKey, t) : sessionStorage.removeItem(this.storageKey);
  }
  getCampaign() {
    return this.req<{ campaign: PublicCampaign; stats: { total: number; eligible: number } }>(`/campaigns/${this.campaignId}`);
  }
  /** Full sign-in: request nonce, ask wallet to sign, exchange for a session. */
  async signIn(wallet: string, signMessage: (msg: Uint8Array) => Promise<Uint8Array>, encodeSig: (s: Uint8Array) => string) {
    const { nonce, message } = await this.req<{ nonce: string; message: string }>(`/campaigns/${this.campaignId}/auth/nonce`, { method: "POST", body: JSON.stringify({ wallet }) });
    const sig = await signMessage(new TextEncoder().encode(message));
    const out = await this.req<{ token: string; entry: Entry }>(`/campaigns/${this.campaignId}/auth/verify`, { method: "POST", body: JSON.stringify({ wallet, nonce, signature: encodeSig(sig) }) });
    this.setToken(out.token);
    return out.entry;
  }
  me() {
    return this.req<{ entry: Entry; social: { provider: string; handle?: string }[] }>(`/campaigns/${this.campaignId}/me`);
  }
  verify(key: string, input: unknown = {}) {
    return this.req<{ entry: Entry; result: RequirementResult }>(`/campaigns/${this.campaignId}/requirements/${key}/verify`, { method: "POST", body: JSON.stringify(input) });
  }
  oauthUrl(provider: "x" | "discord" | "google", key: string, returnTo = typeof location !== "undefined" ? location.href : "/") {
    return this.req<{ url: string }>(`/campaigns/${this.campaignId}/oauth/${provider}/start?key=${encodeURIComponent(key)}&return=${encodeURIComponent(returnTo)}`);
  }
  eligibility(wallet: string) {
    return this.req<{ eligible: boolean; allocation: number; points: number; rank?: number; merkle?: { root: string; proof: string[] } }>(`/campaigns/${this.campaignId}/eligibility/${wallet}`);
  }
}
