import type { ModuleRegistry } from "@solana-allowlist/core";
import type { Storage } from "./storage/types.js";
import type { Verifier } from "./verifiers/types.js";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface ServerConfig {
  storage: Storage;
  /** Public origin of this API, e.g. https://api.myproject.xyz — used for OAuth callbacks. */
  baseUrl: string;
  /** Domain shown in the sign-in message (defaults to hostname of baseUrl). */
  domain?: string;
  /** Origins allowed to embed the widget. */
  corsOrigins?: string[] | "*";
  /** 32+ byte secret for signing sessions. */
  sessionSecret: string;
  sessionTtlSeconds?: number;
  /** Bootstrap admin key. Additional keys can be created via API. */
  adminApiKey?: string;
  /** Require an API key for the public eligibility lookup endpoint. */
  protectEligibilityLookup?: boolean;

  solana: {
    rpcUrl: string;
    /** DAS-compatible endpoint (Helius, Triton, QuickNode…) for NFT lookups. Defaults to rpcUrl. */
    dasUrl?: string;
  };

  oauth?: {
    x?: OAuthClient;
    discord?: OAuthClient & { botToken?: string };
    google?: OAuthClient;
  };
  telegram?: { botToken: string; botUsername: string };
  captcha?: {
    turnstileSecret?: string;
    hcaptchaSecret?: string;
    recaptchaSecret?: string;
  };

  /** Custom modules & verifiers. */
  registry?: ModuleRegistry;
  verifiers?: Verifier[];

  rateLimit?: { windowSeconds: number; max: number };
}

export function normalizeConfig(cfg: ServerConfig) {
  const url = new URL(cfg.baseUrl);
  return {
    ...cfg,
    domain: cfg.domain ?? url.host,
    sessionTtlSeconds: cfg.sessionTtlSeconds ?? 60 * 60 * 24,
    corsOrigins: cfg.corsOrigins ?? "*",
    rateLimit: cfg.rateLimit ?? { windowSeconds: 60, max: 60 },
    solana: { ...cfg.solana, dasUrl: cfg.solana.dasUrl ?? cfg.solana.rpcUrl },
  };
}
export type NormalizedConfig = ReturnType<typeof normalizeConfig>;
