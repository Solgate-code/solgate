import { CampaignSchema, type AllocationConfig, type Campaign, type Entry, type RequirementResult } from "./types.js";
import type { ModuleRegistry } from "./modules.js";

/** Parse + validate a campaign, including every requirement's module config. */
export function parseCampaign(input: unknown, registry: ModuleRegistry): Campaign {
  const parsed = CampaignSchema.parse(input);
  const seen = new Set<string>();
  const requirements = parsed.requirements.map((r) => {
    if (seen.has(r.key)) throw new Error(`Duplicate requirement key '${r.key}'`);
    seen.add(r.key);
    return { ...r, config: registry.parseConfig(r.module, r.config ?? {}) };
  });
  return { ...parsed, requirements };
}

export function isCampaignOpen(c: Campaign, now = Date.now()) {
  if (c.startsAt && now < Date.parse(c.startsAt)) return false;
  if (c.endsAt && now > Date.parse(c.endsAt)) return false;
  return true;
}

/** Sum of points from passed requirements plus any bonus points (referral credits etc.). */
export function computePoints(c: Campaign, results: Record<string, RequirementResult>, bonusPoints = 0) {
  return c.requirements.reduce((sum, r) => sum + (results[r.key]?.passed ? r.points ?? 0 : 0), 0) + Math.max(0, bonusPoints);
}

/** Eligible iff every required requirement passed and points >= minPoints. */
export function computeEligibility(c: Campaign, results: Record<string, RequirementResult>, bonusPoints = 0) {
  const missing = c.requirements.filter((r) => r.required !== false && !results[r.key]?.passed).map((r) => r.key);
  const points = computePoints(c, results, bonusPoints);
  const eligible = missing.length === 0 && points >= (c.minPoints ?? 0);
  return { eligible, points, missing };
}

export function computeAllocation(alloc: AllocationConfig, points: number, results: Record<string, RequirementResult>) {
  let a = 0;
  switch (alloc.mode) {
    case "flat":
      a = alloc.flat;
      break;
    case "tiered": {
      const tiers = [...alloc.tiers].sort((x, y) => y.minPoints - x.minPoints);
      const t = tiers.find((t) => points >= t.minPoints);
      a = t ? t.allocation : 0;
      break;
    }
    case "per-requirement":
      a = Object.entries(alloc.perRequirement).reduce((s, [k, v]) => s + (results[k]?.passed ? v : 0), 0);
      break;
  }
  if (alloc.maxPerWallet) a = Math.min(a, alloc.maxPerWallet);
  return a;
}

/** Recompute derived fields on an entry (pure). */
export function evaluateEntry(c: Campaign, entry: Entry, now = Date.now()): Entry {
  const { eligible, points } = computeEligibility(c, entry.results, entry.bonusPoints ?? 0);
  const allocation = eligible ? computeAllocation(c.allocation, points, entry.results) : 0;
  // eligibleAt is sticky: first transition into eligibility wins the queue position.
  const eligibleAt = entry.eligibleAt ?? (eligible ? now : undefined);
  return { ...entry, eligible, points, allocation, eligibleAt, updatedAt: now };
}

/** Deterministic ordering for FCFS: eligibility time, then wallet as tie-breaker. */
export function rankEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const ta = a.eligibleAt ?? Number.MAX_SAFE_INTEGER;
    const tb = b.eligibleAt ?? Number.MAX_SAFE_INTEGER;
    return ta !== tb ? ta - tb : a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  });
}

/**
 * Apply campaign-wide caps (maxEntries, allocation.totalSupply) across all entries.
 * Entries are ranked by `eligibleAt` (the moment they first became eligible),
 * not by registration time; returns a new array.
 */
export function applyCaps(c: Campaign, entries: Entry[]): Entry[] {
  const sorted = rankEntries(entries);
  let rank = 0;
  let supplyUsed = 0;
  return sorted.map((e) => {
    if (!e.eligible) return { ...e, rank: undefined, allocation: 0 };
    rank += 1;
    let allocation = e.allocation;
    let eligible = true;
    if (c.maxEntries && rank > c.maxEntries) {
      eligible = false;
      allocation = 0;
    }
    if (eligible && c.allocation.totalSupply) {
      const remaining = Math.max(0, c.allocation.totalSupply - supplyUsed);
      allocation = Math.min(allocation, remaining);
      if (allocation === 0) eligible = false;
    }
    supplyUsed += allocation;
    return { ...e, rank: eligible ? rank : undefined, eligible, allocation };
  });
}
