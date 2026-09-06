import type { Campaign, Entry } from "@solana-allowlist/core";

export interface SocialLink {
  campaignId: string;
  provider: string; // x | discord | telegram | google
  providerUserId: string;
  wallet: string;
  handle?: string;
  meta?: Record<string, unknown>;
  createdAt: number;
}

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[]; // ["*"] for all
  campaignId?: string; // undefined = all campaigns
  active: boolean;
  createdAt: number;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  eventId: string;
  status: number;
  attempts: number;
  lastError?: string;
  createdAt: number;
}

export interface ApiKey {
  id: string;
  hash: string; // sha256 of key
  label: string;
  scopes: ("admin" | "read")[];
  createdAt: number;
}

/**
 * Storage adapter. Every method is async so the same interface works for
 * in-memory, SQLite, Postgres, D1, KV, etc. Keep it small on purpose.
 */
export interface Storage {
  // campaigns
  getCampaign(id: string): Promise<Campaign | null>;
  listCampaigns(): Promise<Campaign[]>;
  putCampaign(c: Campaign): Promise<void>;
  deleteCampaign(id: string): Promise<void>;

  // entries
  getEntry(campaignId: string, wallet: string): Promise<Entry | null>;
  putEntry(e: Entry): Promise<void>;
  listEntries(campaignId: string, opts?: { eligibleOnly?: boolean; offset?: number; limit?: number }): Promise<Entry[]>;
  countEntries(campaignId: string, opts?: { eligibleOnly?: boolean }): Promise<number>;
  findEntryByReferralCode(campaignId: string, code: string): Promise<Entry | null>;

  // short-lived values (nonces, oauth state, rate limits) with TTL
  setTemp(key: string, value: string, ttlSeconds: number): Promise<void>;
  getTemp(key: string): Promise<string | null>;
  deleteTemp(key: string): Promise<void>;
  /** Atomic increment with TTL, for rate limiting. Returns new value. */
  incrTemp(key: string, ttlSeconds: number): Promise<number>;

  // social identity uniqueness
  getSocialLink(campaignId: string, provider: string, providerUserId: string): Promise<SocialLink | null>;
  putSocialLink(link: SocialLink): Promise<void>;
  listSocialLinksForWallet(campaignId: string, wallet: string): Promise<SocialLink[]>;

  // webhooks
  listWebhooks(): Promise<Webhook[]>;
  putWebhook(w: Webhook): Promise<void>;
  deleteWebhook(id: string): Promise<void>;
  putDelivery(d: WebhookDelivery): Promise<void>;

  // api keys
  listApiKeys(): Promise<ApiKey[]>;
  putApiKey(k: ApiKey): Promise<void>;
  deleteApiKey(id: string): Promise<void>;
}
