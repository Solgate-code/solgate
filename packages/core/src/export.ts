import type { Campaign, Entry } from "./types.js";
import { buildMerkleTree, getMerkleProof } from "./merkle.js";

export interface ExportOptions {
  /** Include only eligible entries (default true). */
  eligibleOnly?: boolean;
  /** Include per-requirement evidence columns. */
  includeEvidence?: boolean;
  /** Attach Merkle root + proofs when campaign.merkle.enabled. */
  includeMerkle?: boolean;
}

export interface ExportRow {
  wallet: string;
  eligible: boolean;
  points: number;
  allocation: number;
  rank?: number;
  referralCode?: string;
  referredBy?: string;
  createdAt: string;
  [requirementKey: string]: unknown;
}

export function toRows(campaign: Campaign, entries: Entry[], opts: ExportOptions = {}): ExportRow[] {
  const list = opts.eligibleOnly === false ? entries : entries.filter((e) => e.eligible);
  return list.map((e) => {
    const row: ExportRow = {
      wallet: e.wallet,
      eligible: e.eligible,
      points: e.points,
      allocation: e.allocation,
      rank: e.rank,
      referralCode: e.referralCode,
      referredBy: e.referredBy,
      createdAt: new Date(e.createdAt).toISOString(),
    };
    for (const r of campaign.requirements) {
      row[`req:${r.key}`] = e.results[r.key]?.passed ?? false;
      if (opts.includeEvidence && e.results[r.key]?.evidence) {
        row[`evidence:${r.key}`] = JSON.stringify(e.results[r.key].evidence);
      }
    }
    return row;
  });
}

export function toCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: unknown) => {
    if (v === undefined || v === null) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export interface JsonExport {
  campaign: { id: string; name: string; type: string; exportedAt: string };
  count: number;
  totalAllocation: number;
  entries: ExportRow[];
  merkle?: { scheme: string; root: string; proofs: Record<string, string[]> };
}

export function toJSON(campaign: Campaign, entries: Entry[], opts: ExportOptions = {}): JsonExport {
  const rows = toRows(campaign, entries, opts);
  const out: JsonExport = {
    campaign: { id: campaign.id, name: campaign.name, type: campaign.type, exportedAt: new Date().toISOString() },
    count: rows.length,
    totalAllocation: rows.reduce((s, r) => s + r.allocation, 0),
    entries: rows,
  };
  if ((opts.includeMerkle ?? campaign.merkle.enabled) && rows.length > 0) {
    const tree = buildMerkleTree(
      rows.map((r) => r.wallet),
      campaign.merkle.scheme,
    );
    out.merkle = {
      scheme: tree.scheme,
      root: tree.root,
      proofs: Object.fromEntries(rows.map((r) => [r.wallet, getMerkleProof(tree, r.wallet)!])),
    };
  }
  return out;
}

/** Plain newline-separated wallet list — what most mint scripts want. */
export function toWalletList(entries: Entry[]): string {
  return entries
    .filter((e) => e.eligible)
    .map((e) => e.wallet)
    .join("\n");
}
