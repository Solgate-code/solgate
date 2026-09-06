import type { ModuleRegistry } from "@solgate/core";
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
  /**
   * Public eligibility lookup (`GET /campaigns/:id/eligibility/:wallet`) exposure:
   *  - "minimal" (default): anyone can read { eligible, allocation, merkle proof } — what a mint page needs.
   *  - "full": also points and rank without a key.
   *  - "protected": requires a read API key for everything.
   */
  eligibilityLookup?: "minimal" | "full" | "protected";
  /**
   * Which header carries the real client IP. Only trust headers your reverse
   * proxy overwrites, otherwise rate limits can be bypassed by spoofing.
   *  - "none" (default): use the socket address supplied via `getClientIp`, else no per-IP limiting
   *  - "cloudflare": cf-connecting-ip
   *  - "x-forwarded-for": first hop of x-forwarded-for (nginx, Vercel, Railway, Fly)
   */
  trustProxy?: "none" | "cloudflare" | "x-forwarded-for";
  /** Runtime-specific socket address resolver (e.g. @hono/node-server's getConnInfo). */
  getClientIp?: (req: Request) => string | undefined;
  /** Origins the OAuth flow may redirect back to, in addition to baseUrl and corsOrigins. */
  allowedReturnOrigins?: string[];
  /** Allow http:// webhook targets (development only). */
  allowInsecureWebhooks?: boolean;

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
    eligibilityLookup: cfg.eligibilityLookup ?? "minimal",
    trustProxy: cfg.trustProxy ?? "none",
    rateLimit: cfg.rateLimit ?? { windowSeconds: 60, max: 60 },
    solana: { ...cfg.solana, dasUrl: cfg.solana.dasUrl ?? cfg.solana.rpcUrl },
  };
}
export type NormalizedConfig = ReturnType<typeof normalizeConfig>;
