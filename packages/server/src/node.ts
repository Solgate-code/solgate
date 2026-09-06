/** Node entry: build config from env and start an HTTP server. */
import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import { createAllowlistApp } from "./app.js";
import { createSqliteStorage } from "./storage/sqlite.js";
import { MemoryStorage } from "./storage/memory.js";
import type { ServerConfig } from "./config.js";

export async function configFromEnv(env: Record<string, string | undefined> = process.env): Promise<ServerConfig> {
  const storage = env.ALLOWLIST_DB === "memory" ? new MemoryStorage() : await createSqliteStorage(env.ALLOWLIST_DB ?? "allowlist.db");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return {
    storage,
    baseUrl: env.BASE_URL ?? "http://localhost:8787",
    sessionSecret: env.SESSION_SECRET,
    adminApiKey: env.ADMIN_API_KEY,
    corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",").map((s) => s.trim()) : "*",
    eligibilityLookup: (env.ELIGIBILITY_LOOKUP as "minimal" | "full" | "protected" | undefined) ?? "minimal",
    trustProxy: (env.TRUST_PROXY as "none" | "cloudflare" | "x-forwarded-for" | undefined) ?? "none",
    allowedReturnOrigins: env.ALLOWED_RETURN_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
    allowInsecureWebhooks: env.ALLOW_INSECURE_WEBHOOKS === "true",
    solana: { rpcUrl: env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", dasUrl: env.SOLANA_DAS_URL },
    oauth: {
      x: env.X_CLIENT_ID ? { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET ?? "" } : undefined,
      discord: env.DISCORD_CLIENT_ID ? { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET ?? "", botToken: env.DISCORD_BOT_TOKEN } : undefined,
      google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET ?? "" } : undefined,
    },
    telegram: env.TELEGRAM_BOT_TOKEN ? { botToken: env.TELEGRAM_BOT_TOKEN, botUsername: env.TELEGRAM_BOT_USERNAME ?? "" } : undefined,
    captcha: { turnstileSecret: env.TURNSTILE_SECRET, hcaptchaSecret: env.HCAPTCHA_SECRET, recaptchaSecret: env.RECAPTCHA_SECRET },
  };
}

export async function startNodeServer(port = Number(process.env.PORT ?? 8787)) {
  const config = await configFromEnv();
  const { app } = createAllowlistApp(config, { getClientIp: (c) => getConnInfo(c as Context).remote.address });
  serve({ fetch: app.fetch, port }, () => console.log(`solgate API listening on http://localhost:${port}`));
  return app;
}
