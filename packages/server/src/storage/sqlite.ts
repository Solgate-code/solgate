import type { Campaign, Entry } from "@solana-allowlist/core";
import type { ApiKey, SocialLink, Storage, Webhook, WebhookDelivery } from "./types.js";

/**
 * SQLite adapter using better-sqlite3 (Node). Single-file, zero-ops.
 * The same SQL works for Postgres with trivial changes — see docs/storage.md.
 */
export async function createSqliteStorage(file = "allowlist.db"): Promise<Storage> {
  const mod = await import("better-sqlite3");
  const Database = (mod.default ?? mod) as unknown as new (f: string) => import("better-sqlite3").Database;
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaigns (id TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS entries (
      campaign_id TEXT NOT NULL, wallet TEXT NOT NULL, json TEXT NOT NULL,
      eligible INTEGER NOT NULL, referral_code TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY (campaign_id, wallet)
    );
    CREATE INDEX IF NOT EXISTS entries_ref ON entries(campaign_id, referral_code);
    CREATE INDEX IF NOT EXISTS entries_created ON entries(campaign_id, created_at);
    CREATE TABLE IF NOT EXISTS temp (k TEXT PRIMARY KEY, v TEXT NOT NULL, exp INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS social_links (
      campaign_id TEXT NOT NULL, provider TEXT NOT NULL, provider_user_id TEXT NOT NULL,
      wallet TEXT NOT NULL, json TEXT NOT NULL,
      PRIMARY KEY (campaign_id, provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS social_wallet ON social_links(campaign_id, wallet);
    CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, webhook_id TEXT, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  `);
  const j = <T>(row: { json: string } | undefined) => (row ? (JSON.parse(row.json) as T) : null);

  const s: Storage = {
    async getCampaign(id) {
      return j<Campaign>(db.prepare("SELECT json FROM campaigns WHERE id=?").get(id) as never);
    },
    async listCampaigns() {
      return (db.prepare("SELECT json FROM campaigns ORDER BY updated_at DESC").all() as { json: string }[]).map((r) => JSON.parse(r.json));
    },
    async putCampaign(c) {
      db.prepare("INSERT OR REPLACE INTO campaigns (id,json,updated_at) VALUES (?,?,?)").run(c.id, JSON.stringify(c), Date.now());
    },
    async deleteCampaign(id) {
      db.prepare("DELETE FROM campaigns WHERE id=?").run(id);
      db.prepare("DELETE FROM entries WHERE campaign_id=?").run(id);
      db.prepare("DELETE FROM social_links WHERE campaign_id=?").run(id);
    },
    async getEntry(campaignId, wallet) {
      return j<Entry>(db.prepare("SELECT json FROM entries WHERE campaign_id=? AND wallet=?").get(campaignId, wallet) as never);
    },
    async putEntry(e) {
      db.prepare(
        "INSERT OR REPLACE INTO entries (campaign_id,wallet,json,eligible,referral_code,created_at) VALUES (?,?,?,?,?,?)",
      ).run(e.campaignId, e.wallet, JSON.stringify(e), e.eligible ? 1 : 0, e.referralCode ?? null, e.createdAt);
    },
    async listEntries(campaignId, opts = {}) {
      const rows = db
        .prepare(
          `SELECT json FROM entries WHERE campaign_id=? ${opts.eligibleOnly ? "AND eligible=1" : ""} ORDER BY created_at ASC LIMIT ? OFFSET ?`,
        )
        .all(campaignId, opts.limit ?? 1_000_000, opts.offset ?? 0) as { json: string }[];
      return rows.map((r) => JSON.parse(r.json));
    },
    async countEntries(campaignId, opts = {}) {
      const r = db
        .prepare(`SELECT COUNT(*) as n FROM entries WHERE campaign_id=? ${opts.eligibleOnly ? "AND eligible=1" : ""}`)
        .get(campaignId) as { n: number };
      return r.n;
    },
    async findEntryByReferralCode(campaignId, code) {
      return j<Entry>(db.prepare("SELECT json FROM entries WHERE campaign_id=? AND referral_code=?").get(campaignId, code) as never);
    },
    async setTemp(k, v, ttl) {
      db.prepare("INSERT OR REPLACE INTO temp (k,v,exp) VALUES (?,?,?)").run(k, v, Date.now() + ttl * 1000);
    },
    async getTemp(k) {
      const r = db.prepare("SELECT v,exp FROM temp WHERE k=?").get(k) as { v: string; exp: number } | undefined;
      if (!r) return null;
      if (r.exp < Date.now()) {
        db.prepare("DELETE FROM temp WHERE k=?").run(k);
        return null;
      }
      return r.v;
    },
    async deleteTemp(k) {
      db.prepare("DELETE FROM temp WHERE k=?").run(k);
    },
    async incrTemp(k, ttl) {
      const cur = Number((await s.getTemp(k)) ?? 0) + 1;
      const r = db.prepare("SELECT exp FROM temp WHERE k=?").get(k) as { exp: number } | undefined;
      db.prepare("INSERT OR REPLACE INTO temp (k,v,exp) VALUES (?,?,?)").run(k, String(cur), r?.exp ?? Date.now() + ttl * 1000);
      return cur;
    },
    async getSocialLink(campaignId, provider, providerUserId) {
      return j<SocialLink>(
        db.prepare("SELECT json FROM social_links WHERE campaign_id=? AND provider=? AND provider_user_id=?").get(campaignId, provider, providerUserId) as never,
      );
    },
    async putSocialLink(l) {
      db.prepare("INSERT OR REPLACE INTO social_links (campaign_id,provider,provider_user_id,wallet,json) VALUES (?,?,?,?,?)").run(
        l.campaignId, l.provider, l.providerUserId, l.wallet, JSON.stringify(l),
      );
    },
    async listSocialLinksForWallet(campaignId, wallet) {
      return (db.prepare("SELECT json FROM social_links WHERE campaign_id=? AND wallet=?").all(campaignId, wallet) as { json: string }[]).map((r) => JSON.parse(r.json));
    },
    async listWebhooks() {
      return (db.prepare("SELECT json FROM webhooks").all() as { json: string }[]).map((r) => JSON.parse(r.json));
    },
    async putWebhook(w) {
      db.prepare("INSERT OR REPLACE INTO webhooks (id,json) VALUES (?,?)").run(w.id, JSON.stringify(w));
    },
    async deleteWebhook(id) {
      db.prepare("DELETE FROM webhooks WHERE id=?").run(id);
    },
    async putDelivery(d: WebhookDelivery) {
      db.prepare("INSERT OR REPLACE INTO deliveries (id,webhook_id,json) VALUES (?,?,?)").run(d.id, d.webhookId, JSON.stringify(d));
    },
    async listApiKeys() {
      return (db.prepare("SELECT json FROM api_keys").all() as { json: string }[]).map((r) => JSON.parse(r.json));
    },
    async putApiKey(k: ApiKey) {
      db.prepare("INSERT OR REPLACE INTO api_keys (id,json) VALUES (?,?)").run(k.id, JSON.stringify(k));
    },
    async deleteApiKey(id) {
      db.prepare("DELETE FROM api_keys WHERE id=?").run(id);
    },
  };
  return s;
}
