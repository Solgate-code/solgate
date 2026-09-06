import type { Campaign, Entry, Requirement, RequirementResult } from "@solana-allowlist/core";
import type { Storage } from "../storage/types.js";
import type { NormalizedConfig } from "../config.js";

export interface VerifyContext<TConfig = unknown, TInput = unknown> {
  campaign: Campaign;
  requirement: Requirement<TConfig>;
  config: TConfig;
  wallet: string;
  entry: Entry;
  /** Client-supplied payload (quiz answers, captcha token, referral code, oauth profile…). */
  input: TInput;
  storage: Storage;
  cfg: NormalizedConfig;
  /** Request metadata for rate limiting / audit. */
  ip?: string;
}

export interface Verifier<TConfig = unknown, TInput = unknown> {
  moduleId: string;
  verify(ctx: VerifyContext<TConfig, TInput>): Promise<RequirementResult>;
  /** Optional: return public config safe for the browser (e.g. strip quiz answers). */
  publicConfig?(config: TConfig): unknown;
}

export const pass = (key: string, module: string, evidence?: Record<string, unknown>): RequirementResult => ({
  key,
  module,
  passed: true,
  evidence,
  checkedAt: Date.now(),
});
export const fail = (key: string, module: string, reason: string, evidence?: Record<string, unknown>): RequirementResult => ({
  key,
  module,
  passed: false,
  reason,
  evidence,
  checkedAt: Date.now(),
});
