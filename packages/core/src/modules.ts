/**
 * Built-in module definitions. These are *descriptions only* — the actual
 * verification logic lives in @solana-allowlist/server (or your own verifier).
 * Keeping definitions here lets the browser widget and the admin UI validate
 * configs and render forms without pulling in server dependencies.
 */
import { z } from "zod";
import type { ModuleDefinition } from "./types.js";

const pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid Solana public key");

export const WalletSignatureModule = {
  id: "wallet-signature",
  label: "Wallet signature",
  description: "Prove ownership of the Solana wallet by signing a nonce. Implicit in every campaign.",
  category: "onchain",
  configSchema: z.object({
    /** Custom prefix shown in the signed message. */
    statement: z.string().max(200).optional(),
  }),
} satisfies ModuleDefinition;

export const TokenBalanceModule = {
  id: "token-balance",
  label: "SPL token balance",
  description: "Hold at least N units of an SPL / Token-2022 mint.",
  category: "onchain",
  recheckable: true,
  configSchema: z.object({
    mint: pubkey,
    /** Minimum balance in UI units (already divided by decimals). */
    min: z.number().nonnegative(),
    /** Count tokens in the wallet-owned associated + auxiliary accounts (default true). */
    includeAllAccounts: z.boolean().default(true),
  }),
} satisfies ModuleDefinition;

export const NftOwnershipModule = {
  id: "nft-ownership",
  label: "NFT ownership",
  description: "Own at least N NFTs from a verified collection (or a specific mint).",
  category: "onchain",
  recheckable: true,
  configSchema: z
    .object({
      /** Metaplex certified collection address (Core, Token Metadata or cNFT). */
      collection: pubkey.optional(),
      /** Alternative: exact mint addresses. */
      mints: z.array(pubkey).optional(),
      /** Creator address (first-verified-creator style gating). */
      creator: pubkey.optional(),
      min: z.number().int().positive().default(1),
    })
    .refine((c) => c.collection || c.mints?.length || c.creator, {
      message: "Provide collection, mints or creator",
    }),
} satisfies ModuleDefinition;

export const XVerificationModule = {
  id: "x-verify",
  label: "X (Twitter) verification",
  description: "Connect an X account via OAuth 2.0. Optionally require a follow.",
  category: "social",
  configSchema: z.object({
    /** X username (without @) the user must follow. Requires elevated API access; leave blank to only link. */
    follow: z.string().optional(),
    /** Minimum account age in days (spam defence). */
    minAccountAgeDays: z.number().int().nonnegative().default(0),
    minFollowers: z.number().int().nonnegative().default(0),
  }),
} satisfies ModuleDefinition;

export const DiscordVerificationModule = {
  id: "discord-verify",
  label: "Discord verification",
  description: "Connect Discord via OAuth 2.0 and (optionally) require guild membership / role.",
  category: "social",
  configSchema: z.object({
    guildId: z.string().optional(),
    /** Role IDs; user needs any one of them. Requires a bot in the guild. */
    roleIds: z.array(z.string()).default([]),
  }),
} satisfies ModuleDefinition;

export const TelegramVerificationModule = {
  id: "telegram-verify",
  label: "Telegram verification",
  description: "Verify via Telegram Login Widget; optionally require channel/group membership.",
  category: "social",
  configSchema: z.object({
    /** @channel username or numeric chat id. Requires the bot to be a member/admin. */
    chatId: z.string().optional(),
  }),
} satisfies ModuleDefinition;

export const YouTubeVerificationModule = {
  id: "youtube-verify",
  label: "YouTube subscription",
  description: "Connect Google and verify a subscription to a channel (youtube.readonly scope).",
  category: "social",
  configSchema: z.object({
    channelId: z.string().min(1),
  }),
} satisfies ModuleDefinition;

export const SocialTaskModule = {
  id: "social-task",
  label: "Social task (self-attested / link)",
  description:
    "A task the platform cannot verify programmatically (e.g. retweet, like a video). Records a click-through and an optional proof URL; optionally requires admin approval.",
  category: "social",
  configSchema: z.object({
    url: z.string().url(),
    label: z.string().min(1),
    requireProofUrl: z.boolean().default(false),
    requireApproval: z.boolean().default(false),
    /** Minimum seconds between opening the link and marking complete. */
    minDwellSeconds: z.number().int().nonnegative().default(5),
  }),
} satisfies ModuleDefinition;

export const QuizQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(["single", "multi", "text"]).default("single"),
  options: z.array(z.string()).optional(),
  /** Correct option indices (single/multi) or regex/string for text. Kept server-side. */
  answer: z.union([z.number(), z.array(z.number()), z.string()]).optional(),
  required: z.boolean().default(true),
});

export const QuizModule = {
  id: "quiz",
  label: "Quiz / custom questions",
  description: "Ask questions. Score against answers or just collect responses.",
  category: "input",
  configSchema: z.object({
    questions: z.array(QuizQuestionSchema).min(1),
    /** Required fraction of scored questions correct (0–1). 0 = collection only. */
    passScore: z.number().min(0).max(1).default(1),
    maxAttempts: z.number().int().positive().default(3),
  }),
} satisfies ModuleDefinition;

export const ReferralModule = {
  id: "referral",
  label: "Referral code",
  description: "Users enter a referral code from another participant; referrers earn points.",
  category: "input",
  configSchema: z.object({
    /** Does entering a code count as completing this requirement? */
    requireCode: z.boolean().default(false),
    /** Points credited to the referrer per successful referral. */
    referrerPoints: z.number().int().nonnegative().default(1),
    /** Cap on credited referrals per referrer. */
    maxReferrals: z.number().int().positive().default(100),
  }),
} satisfies ModuleDefinition;

export const CaptchaModule = {
  id: "captcha",
  label: "CAPTCHA",
  description: "Cloudflare Turnstile, hCaptcha or reCAPTCHA v3 token verification.",
  category: "input",
  configSchema: z.object({
    provider: z.enum(["turnstile", "hcaptcha", "recaptcha"]),
    siteKey: z.string().min(1),
    /** Minimum score for reCAPTCHA v3. */
    minScore: z.number().min(0).max(1).default(0.5),
  }),
} satisfies ModuleDefinition;

export const builtinModules: ModuleDefinition[] = [
  WalletSignatureModule,
  TokenBalanceModule,
  NftOwnershipModule,
  XVerificationModule,
  DiscordVerificationModule,
  TelegramVerificationModule,
  YouTubeVerificationModule,
  SocialTaskModule,
  QuizModule,
  ReferralModule,
  CaptchaModule,
];

/** Registry so hosts/plugins can add modules. */
export class ModuleRegistry {
  private map = new Map<string, ModuleDefinition>();
  constructor(defs: ModuleDefinition[] = builtinModules) {
    defs.forEach((d) => this.register(d));
  }
  register(def: ModuleDefinition) {
    if (this.map.has(def.id)) throw new Error(`Module '${def.id}' already registered`);
    this.map.set(def.id, def);
    return this;
  }
  get(id: string) {
    return this.map.get(id);
  }
  has(id: string) {
    return this.map.has(id);
  }
  list() {
    return [...this.map.values()];
  }
  /** Validate a requirement's config against its module schema; throws ZodError. */
  parseConfig<T = unknown>(moduleId: string, config: unknown): T {
    const def = this.get(moduleId);
    if (!def) throw new Error(`Unknown module '${moduleId}'`);
    return def.configSchema.parse(config) as T;
  }
}
