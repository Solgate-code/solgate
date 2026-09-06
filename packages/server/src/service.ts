import {
  ModuleRegistry,
  applyCaps,
  evaluateEntry,
  isCampaignOpen,
  parseCampaign,
  type Campaign,
  type Entry,
  type RequirementResult,
} from "@solana-allowlist/core";
import type { NormalizedConfig } from "./config.js";
import { builtinVerifiers, type Verifier } from "./verifiers/index.js";
import { EventBus } from "./webhooks.js";
import { randomId } from "./crypto.js";

export class AllowlistError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
  }
}

/** Framework-agnostic business logic. Routes are thin wrappers over this. */
export class AllowlistService {
  registry: ModuleRegistry;
  verifiers = new Map<string, Verifier>();
  events: EventBus;

  constructor(public cfg: NormalizedConfig, waitUntil?: (p: Promise<unknown>) => void) {
    this.registry = cfg.registry ?? new ModuleRegistry();
    for (const v of [...builtinVerifiers, ...(cfg.verifiers ?? [])]) this.verifiers.set(v.moduleId, v);
    this.events = new EventBus(cfg.storage, waitUntil);
  }

  /* ---------- campaigns ---------- */
  async getCampaign(id: string) {
    const c = await this.cfg.storage.getCampaign(id);
    if (!c) throw new AllowlistError(404, "Campaign not found", "campaign_not_found");
    return c;
  }
  async saveCampaign(input: unknown) {
    const c = parseCampaign(input, this.registry);
    const prev = await this.cfg.storage.getCampaign(c.id);
    c.createdAt = prev?.createdAt ?? new Date().toISOString();
    c.updatedAt = new Date().toISOString();
    await this.cfg.storage.putCampaign(c);
    await this.events.emit("campaign.updated", c.id, { name: c.name });
    return c;
  }
  /** Campaign as seen by the browser: quiz answers etc. stripped. */
  publicCampaign(c: Campaign) {
    return {
      ...c,
      requirements: c.requirements.map((r) => {
        const v = this.verifiers.get(r.module);
        const def = this.registry.get(r.module);
        return {
          ...r,
          config: v?.publicConfig ? v.publicConfig(r.config) : r.config,
          category: def?.category ?? "custom",
          label: r.title ?? def?.label ?? r.module,
        };
      }),
    };
  }

  /* ---------- entries ---------- */
  async getOrCreateEntry(c: Campaign, wallet: string): Promise<Entry> {
    const s = this.cfg.storage;
    let e = await s.getEntry(c.id, wallet);
    if (e) return e;
    if (!isCampaignOpen(c)) throw new AllowlistError(403, "Registration is closed", "campaign_closed");
    const now = Date.now();
    e = {
      campaignId: c.id,
      wallet,
      results: {},
      eligible: false,
      points: 0,
      allocation: 0,
      referralCode: await this.uniqueReferralCode(c.id),
      createdAt: now,
      updatedAt: now,
    };
    // wallet signature requirement is satisfied by session creation
    for (const r of c.requirements.filter((r) => r.module === "wallet-signature")) {
      e.results[r.key] = { key: r.key, module: r.module, passed: true, checkedAt: now, evidence: { wallet } };
    }
    e = evaluateEntry(c, e, now);
    await s.putEntry(e);
    await this.events.emit("entry.created", c.id, { eligible: e.eligible }, wallet);
    return e;
  }

  private async uniqueReferralCode(campaignId: string) {
    for (let i = 0; i < 5; i++) {
      const code = randomId(4).toUpperCase().slice(0, 8);
      if (!(await this.cfg.storage.findEntryByReferralCode(campaignId, code))) return code;
    }
    return randomId(6).toUpperCase();
  }

  /** Run one requirement's verifier and persist the result. */
  async verifyRequirement(c: Campaign, wallet: string, key: string, input: unknown, ip?: string): Promise<{ entry: Entry; result: RequirementResult }> {
    const requirement = c.requirements.find((r) => r.key === key);
    if (!requirement) throw new AllowlistError(404, "Unknown requirement", "requirement_not_found");
    const verifier = this.verifiers.get(requirement.module);
    if (!verifier) throw new AllowlistError(501, `No verifier for module '${requirement.module}'`, "no_verifier");
    if (!isCampaignOpen(c)) throw new AllowlistError(403, "Registration is closed", "campaign_closed");

    const entry = await this.getOrCreateEntry(c, wallet);
    const wasEligible = entry.eligible;
    const result = await verifier.verify({
      campaign: c,
      requirement,
      config: requirement.config,
      wallet,
      entry,
      input,
      storage: this.cfg.storage,
      cfg: this.cfg,
      ip,
    });
    entry.results[key] = result;
    const updated = evaluateEntry(c, entry);
    await this.cfg.storage.putEntry(updated);

    await this.events.emit(result.passed ? "requirement.passed" : "requirement.failed", c.id, { key, result }, wallet);
    if (updated.eligible !== wasEligible) {
      await this.events.emit(updated.eligible ? "entry.eligible" : "entry.ineligible", c.id, { points: updated.points, allocation: updated.allocation }, wallet);
    } else {
      await this.events.emit("entry.updated", c.id, { key, passed: result.passed }, wallet);
    }
    return { entry: updated, result };
  }

  /** Re-run all recheckable (on-chain) requirements for every entry — e.g. snapshot before mint. */
  async recheckCampaign(c: Campaign, onlyWallets?: string[]) {
    const recheckable = c.requirements.filter((r) => this.registry.get(r.module)?.recheckable);
    const entries = onlyWallets
      ? (await Promise.all(onlyWallets.map((w) => this.cfg.storage.getEntry(c.id, w)))).filter(Boolean) as Entry[]
      : await this.cfg.storage.listEntries(c.id);
    let changed = 0;
    for (const entry of entries) {
      const before = entry.eligible;
      for (const r of recheckable) {
        const v = this.verifiers.get(r.module)!;
        entry.results[r.key] = await v.verify({ campaign: c, requirement: r, config: r.config, wallet: entry.wallet, entry, input: {}, storage: this.cfg.storage, cfg: this.cfg });
      }
      const updated = evaluateEntry(c, entry);
      if (updated.eligible !== before) changed++;
      await this.cfg.storage.putEntry(updated);
    }
    return { checked: entries.length, changed };
  }

  /** Entries with campaign-wide caps applied (ranked FCFS). */
  async finalEntries(c: Campaign) {
    const entries = await this.cfg.storage.listEntries(c.id);
    return applyCaps(c, entries);
  }

  /** Admin override for a single requirement (approve social task, manual pass/fail). */
  async overrideRequirement(c: Campaign, wallet: string, key: string, passed: boolean, note?: string) {
    const entry = await this.cfg.storage.getEntry(c.id, wallet);
    if (!entry) throw new AllowlistError(404, "Entry not found", "entry_not_found");
    const r = c.requirements.find((r) => r.key === key);
    if (!r) throw new AllowlistError(404, "Unknown requirement", "requirement_not_found");
    entry.results[key] = { key, module: r.module, passed, checkedAt: Date.now(), evidence: { ...entry.results[key]?.evidence, override: true, note } };
    const updated = evaluateEntry(c, entry);
    await this.cfg.storage.putEntry(updated);
    await this.events.emit(updated.eligible ? "entry.eligible" : "entry.updated", c.id, { key, passed, override: true }, wallet);
    return updated;
  }
}
