import type { Campaign, Entry } from "@solgate/core";
import type { ApiKey, Snapshot, SocialLink, Storage, Webhook, WebhookDelivery } from "./types.js";

/** In-memory adapter: tests, demos, and stateless edge deployments with a warm cache. */
export class MemoryStorage implements Storage {
  campaigns = new Map<string, Campaign>();
  entries = new Map<string, Entry>(); // `${campaignId}:${wallet}`
  temp = new Map<string, { v: string; exp: number }>();
  social = new Map<string, SocialLink>();
  webhooks = new Map<string, Webhook>();
  deliveries: WebhookDelivery[] = [];
  apiKeys = new Map<string, ApiKey>();
  snapshots = new Map<string, Snapshot>();

  async getCampaign(id: string) {
    return this.campaigns.get(id) ?? null;
  }
  async listCampaigns() {
    return [...this.campaigns.values()];
  }
  async putCampaign(c: Campaign) {
    this.campaigns.set(c.id, c);
  }
  async deleteCampaign(id: string) {
    this.campaigns.delete(id);
    for (const k of [...this.entries.keys()]) if (k.startsWith(id + ":")) this.entries.delete(k);
  }

  async getEntry(campaignId: string, wallet: string) {
    return this.entries.get(`${campaignId}:${wallet}`) ?? null;
  }
  async putEntry(e: Entry) {
    this.entries.set(`${e.campaignId}:${e.wallet}`, e);
  }
  async listEntries(campaignId: string, opts: { eligibleOnly?: boolean; offset?: number; limit?: number } = {}) {
    let list = [...this.entries.values()].filter((e) => e.campaignId === campaignId);
    if (opts.eligibleOnly) list = list.filter((e) => e.eligible);
    list.sort((a, b) => a.createdAt - b.createdAt);
    const off = opts.offset ?? 0;
    return list.slice(off, opts.limit ? off + opts.limit : undefined);
  }
  async countEntries(campaignId: string, opts: { eligibleOnly?: boolean } = {}) {
    return (await this.listEntries(campaignId, opts)).length;
  }
  async findEntryByReferralCode(campaignId: string, code: string) {
    return [...this.entries.values()].find((e) => e.campaignId === campaignId && e.referralCode === code) ?? null;
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.temp) if (v.exp < now) this.temp.delete(k);
  }
  async setTemp(key: string, value: string, ttlSeconds: number) {
    this.sweep();
    this.temp.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
  async getTemp(key: string) {
    const v = this.temp.get(key);
    if (!v || v.exp < Date.now()) return null;
    return v.v;
  }
  async deleteTemp(key: string) {
    this.temp.delete(key);
  }
  async incrTemp(key: string, ttlSeconds: number) {
    const cur = Number((await this.getTemp(key)) ?? 0) + 1;
    const existing = this.temp.get(key);
    this.temp.set(key, { v: String(cur), exp: existing?.exp ?? Date.now() + ttlSeconds * 1000 });
    return cur;
  }

  async getSocialLink(campaignId: string, provider: string, providerUserId: string) {
    return this.social.get(`${campaignId}:${provider}:${providerUserId}`) ?? null;
  }
  // JS is single-threaded, so check-then-set within one synchronous block is atomic here.
  async claimSocialLink(link: SocialLink): Promise<{ ok: true } | { ok: false; owner: string }> {
    const k = `${link.campaignId}:${link.provider}:${link.providerUserId}`;
    const existing = this.social.get(k);
    if (existing && existing.wallet !== link.wallet) return { ok: false, owner: existing.wallet };
    if (!existing) this.social.set(k, link);
    return { ok: true };
  }
  async putSnapshot(s: Snapshot) {
    this.snapshots.set(s.id, s);
  }
  async getSnapshot(campaignId: string, id?: string) {
    const all = [...this.snapshots.values()].filter((s) => s.campaignId === campaignId).sort((a, b) => b.createdAt - a.createdAt);
    return (id ? all.find((s) => s.id === id) : all[0]) ?? null;
  }
  async listSnapshots(campaignId: string) {
    return [...this.snapshots.values()].filter((s) => s.campaignId === campaignId).sort((a, b) => b.createdAt - a.createdAt).map(({ entries: _e, ...s }) => s);
  }
  async listSocialLinksForWallet(campaignId: string, wallet: string) {
    return [...this.social.values()].filter((l) => l.campaignId === campaignId && l.wallet === wallet);
  }

  async listWebhooks() {
    return [...this.webhooks.values()];
  }
  async putWebhook(w: Webhook) {
    this.webhooks.set(w.id, w);
  }
  async deleteWebhook(id: string) {
    this.webhooks.delete(id);
  }
  async putDelivery(d: WebhookDelivery) {
    this.deliveries.push(d);
  }

  async listApiKeys() {
    return [...this.apiKeys.values()];
  }
  async putApiKey(k: ApiKey) {
    this.apiKeys.set(k.id, k);
  }
  async deleteApiKey(id: string) {
    this.apiKeys.delete(id);
  }
}
