import { z } from "zod";

/* ------------------------------------------------------------------ */
/*  Module contract                                                    */
/* ------------------------------------------------------------------ */

/**
 * Every requirement a campaign can impose is a "module".
 * Modules are pure descriptions (id + config schema + metadata); the
 * server package supplies a `Verifier` for each id. Third parties can
 * register their own modules without touching this package.
 */
export interface ModuleDefinition<TConfig = unknown> {
  /** Stable identifier, e.g. "token-balance". */
  id: string;
  /** Human label for the admin UI. */
  label: string;
  description?: string;
  /** Zod schema validating the per-campaign config for this module. */
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  /**
   * Category drives UI grouping and which verifier runs it.
   *  - "onchain": verified purely from RPC/DAS reads
   *  - "social": requires an OAuth / bot handshake
   *  - "input": user submits something (quiz, referral, captcha)
   */
  category: "onchain" | "social" | "input" | "custom";
  /** If true, this module can be re-checked at any time (e.g. balances). Social links are usually not. */
  recheckable?: boolean;
}

/** A requirement is a module instance with concrete config inside a campaign. */
export interface Requirement<TConfig = unknown> {
  /** Unique within the campaign; used as the key in completion state. */
  key: string;
  module: string;
  config: TConfig;
  /** Whether the requirement is mandatory for eligibility (default true). */
  required?: boolean;
  /** Points awarded on completion; feeds tiered allocation. */
  points?: number;
  /** Optional display override. */
  title?: string;
  description?: string;
}

/** Result of verifying one requirement for one wallet. */
export interface RequirementResult {
  key: string;
  module: string;
  passed: boolean;
  /** Free-form evidence: balance found, discord user id, quiz score… */
  evidence?: Record<string, unknown>;
  /** User-facing reason when `passed === false`. */
  reason?: string;
  checkedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Campaign                                                           */
/* ------------------------------------------------------------------ */

export const AllocationTierSchema = z.object({
  /** Minimum points to fall into this tier. */
  minPoints: z.number().int().nonnegative(),
  /** Mint allocation (number of mints / tokens / units) for the tier. */
  allocation: z.number().int().nonnegative(),
  label: z.string().optional(),
});

export const AllocationConfigSchema = z
  .object({
    mode: z.enum(["flat", "tiered", "per-requirement"]).default("flat"),
    /** Flat allocation for everyone eligible. */
    flat: z.number().int().nonnegative().default(1),
    tiers: z.array(AllocationTierSchema).default([]),
    /** For "per-requirement": allocation added per completed requirement key. */
    perRequirement: z.record(z.string(), z.number().int().nonnegative()).default({}),
    /** Hard cap per wallet. */
    maxPerWallet: z.number().int().positive().optional(),
    /** Hard cap on total allocated units (first-come, first-served by rank). */
    totalSupply: z.number().int().positive().optional(),
  })
  .default({ mode: "flat", flat: 1, tiers: [], perRequirement: {} });

export type AllocationConfig = z.infer<typeof AllocationConfigSchema>;

export const CampaignTypeSchema = z.enum([
  "nft-mint",
  "token-launch",
  "presale",
  "community",
  "custom",
]);
export type CampaignType = z.infer<typeof CampaignTypeSchema>;

export const RequirementSchema = z.object({
  key: z.string().min(1).regex(/^[a-z0-9_-]+$/i),
  module: z.string().min(1),
  config: z.unknown(),
  required: z.boolean().default(true),
  points: z.number().int().nonnegative().default(0),
  title: z.string().optional(),
  description: z.string().optional(),
});

export const CampaignSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/i),
  name: z.string().min(1),
  description: z.string().optional(),
  type: CampaignTypeSchema.default("custom"),
  /** Solana cluster used for on-chain checks. */
  cluster: z.enum(["mainnet-beta", "devnet", "testnet"]).default("mainnet-beta"),
  /** ISO timestamps; registration window. */
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  /** Maximum number of eligible wallets (undefined = unlimited). */
  maxEntries: z.number().int().positive().optional(),
  /** Minimum total points required, in addition to all `required` requirements. */
  minPoints: z.number().int().nonnegative().default(0),
  requirements: z.array(RequirementSchema).min(1),
  allocation: AllocationConfigSchema,
  /** Merkle settings for on-chain gating (Candy Machine allowlist guard etc.). */
  merkle: z
    .object({
      enabled: z.boolean().default(false),
      /** "candy-guard" = keccak256(pubkey bytes), sorted-pair hashing (Metaplex). */
      scheme: z.enum(["candy-guard", "sha256-sorted"]).default("candy-guard"),
    })
    .default({ enabled: false, scheme: "candy-guard" }),
  /** Arbitrary project metadata (branding, links). */
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
/** Parsed campaign; `requirements[].config` is always present after `parseCampaign`. */
export type Campaign = Omit<z.infer<typeof CampaignSchema>, "requirements"> & { requirements: Requirement[] };
export type CampaignInput = z.input<typeof CampaignSchema>;

/* ------------------------------------------------------------------ */
/*  Entries (one wallet in one campaign)                               */
/* ------------------------------------------------------------------ */

export interface Entry {
  campaignId: string;
  wallet: string;
  /** Completion state keyed by requirement key. */
  results: Record<string, RequirementResult>;
  /** Derived. */
  eligible: boolean;
  points: number;
  allocation: number;
  /** Referral code owned by this wallet (issued on registration). */
  referralCode?: string;
  /** Wallet that referred this entry, if any. */
  referredBy?: string;
  createdAt: number;
  updatedAt: number;
  /** Position among eligible entries (1-based), used for FCFS caps. */
  rank?: number;
}

/* ------------------------------------------------------------------ */
/*  Events / webhooks                                                  */
/* ------------------------------------------------------------------ */

export type AllowlistEventType =
  | "entry.created"
  | "entry.updated"
  | "entry.eligible"
  | "entry.ineligible"
  | "requirement.passed"
  | "requirement.failed"
  | "campaign.updated"
  | "campaign.exported";

export interface AllowlistEvent<T = unknown> {
  id: string;
  type: AllowlistEventType;
  campaignId: string;
  wallet?: string;
  data: T;
  createdAt: number;
}
