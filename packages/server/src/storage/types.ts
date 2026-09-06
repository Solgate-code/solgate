import type { Campaign, Entry } from "@solgate/core";

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

/** Immutable eligibility snapshot taken before a mint. */
export interface Snapshot {
  id: string;
  campaignId: string;
  createdAt: number;
  count: number;
  totalAllocation: number;
  merkle?: { scheme: string; root: string };
  /** wallet → { allocation, rank, proof } */
  entries: Record<string, { allocation: number; rank: number; proof?: string[] }>;
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
  /** ATOMIC increment with TTL (rate limits, attempt counters, referral caps). Must be safe under concurrency. */
  incrTemp(key: string, ttlSeconds: number): Promise<number>;

  // social identity uniqueness
  getSocialLink(campaignId: string, provider: string, providerUserId: string): Promise<SocialLink | null>;
  /**
   * ATOMIC "insert if absent". Returns `{ ok: true }` when this wallet now owns the identity
   * (fresh insert or already owned by the same wallet), otherwise `{ ok: false, owner }`.
   * The database's unique constraint — not application sequencing — enforces one-identity-one-wallet.
   */
  claimSocialLink(link: SocialLink): Promise<{ ok: true } | { ok: false; owner: string }>;
  listSocialLinksForWallet(campaignId: string, wallet: string): Promise<SocialLink[]>;

  // snapshots
  putSnapshot(s: Snapshot): Promise<void>;
  getSnapshot(campaignId: string, id?: string): Promise<Snapshot | null>; // latest when id omitted
  listSnapshots(campaignId: string): Promise<Omit<Snapshot, "entries">[]>;

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
