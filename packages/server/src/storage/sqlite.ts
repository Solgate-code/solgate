import type { Campaign, Entry } from "@solgate/core";
import type { ApiKey, Snapshot, SocialLink, Storage, Webhook, WebhookDelivery } from "./types.js";

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
    CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS snapshots_campaign ON snapshots(campaign_id, created_at);
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
      // Single UPSERT = atomic under SQLite's write lock. Expired rows restart from 1.
      const now = Date.now();
      const r = db
        .prepare(
          `INSERT INTO temp (k,v,exp) VALUES (?, '1', ?)
           ON CONFLICT(k) DO UPDATE SET
             v   = CASE WHEN temp.exp < ? THEN '1' ELSE CAST(CAST(temp.v AS INTEGER) + 1 AS TEXT) END,
             exp = CASE WHEN temp.exp < ? THEN excluded.exp ELSE temp.exp END
           RETURNING v`,
        )
        .get(k, now + ttl * 1000, now, now) as { v: string };
      return Number(r.v);
    },
    async getSocialLink(campaignId, provider, providerUserId) {
      return j<SocialLink>(
        db.prepare("SELECT json FROM social_links WHERE campaign_id=? AND provider=? AND provider_user_id=?").get(campaignId, provider, providerUserId) as never,
      );
    },
    async claimSocialLink(l) {
      // ON CONFLICT DO NOTHING: the PK enforces uniqueness; we then read back who owns it.
      db.prepare(
        "INSERT INTO social_links (campaign_id,provider,provider_user_id,wallet,json) VALUES (?,?,?,?,?) ON CONFLICT(campaign_id,provider,provider_user_id) DO NOTHING",
      ).run(l.campaignId, l.provider, l.providerUserId, l.wallet, JSON.stringify(l));
      const owner = (db.prepare("SELECT wallet FROM social_links WHERE campaign_id=? AND provider=? AND provider_user_id=?").get(l.campaignId, l.provider, l.providerUserId) as { wallet: string }).wallet;
      return owner === l.wallet ? { ok: true } : { ok: false, owner };
    },
    async putSnapshot(snap: Snapshot) {
      db.prepare("INSERT OR REPLACE INTO snapshots (id,campaign_id,created_at,json) VALUES (?,?,?,?)").run(snap.id, snap.campaignId, snap.createdAt, JSON.stringify(snap));
    },
    async getSnapshot(campaignId, id) {
      const row = id
        ? db.prepare("SELECT json FROM snapshots WHERE campaign_id=? AND id=?").get(campaignId, id)
        : db.prepare("SELECT json FROM snapshots WHERE campaign_id=? ORDER BY created_at DESC LIMIT 1").get(campaignId);
      return j<Snapshot>(row as never);
    },
    async listSnapshots(campaignId) {
      return (db.prepare("SELECT json FROM snapshots WHERE campaign_id=? ORDER BY created_at DESC").all(campaignId) as { json: string }[]).map((r) => {
        const { entries: _e, ...rest } = JSON.parse(r.json) as Snapshot;
        return rest;
      });
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
