import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { buildSignInMessage, buildMerkleTree, getMerkleProof, toCSV, toJSON, toRows, toWalletList } from "@solana-allowlist/core";
import { normalizeConfig, type ServerConfig } from "./config.js";
import { AllowlistError, AllowlistService } from "./service.js";
import { randomId, safeEqual, sha256Hex, signSession, verifySession, verifyWalletSignature } from "./crypto.js";
import { registerOAuthRoutes } from "./routes/oauth.js";

export type AppEnv = {
  Variables: { session: { wallet: string; campaignId: string }; apiKeyScopes: string[] };
};

const pubkey = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export function createAllowlistApp(config: ServerConfig, opts: { waitUntil?: (p: Promise<unknown>) => void } = {}) {
  const cfg = normalizeConfig(config);
  const svc = new AllowlistService(cfg, opts.waitUntil);
  const app = new Hono<AppEnv>();
  const ipOf = (c: Context) =>
    c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0].trim();

  app.use("*", cors({ origin: cfg.corsOrigins === "*" ? "*" : cfg.corsOrigins, allowHeaders: ["content-type", "authorization", "x-api-key"] }));

  app.onError((err, c) => {
    if (err instanceof AllowlistError) return c.json({ error: err.code, message: err.message }, err.status as 400);
    if (err instanceof z.ZodError) return c.json({ error: "validation", message: "Invalid input", issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: "internal", message: "Something went wrong" }, 500);
  });

  /* -------- rate limit (per IP) -------- */
  app.use("*", async (c, next) => {
    const ip = ipOf(c);
    if (ip && cfg.rateLimit.max > 0) {
      const n = await cfg.storage.incrTemp(`rl:${ip}:${Math.floor(Date.now() / 1000 / cfg.rateLimit.windowSeconds)}`, cfg.rateLimit.windowSeconds);
      if (n > cfg.rateLimit.max) return c.json({ error: "rate_limited", message: "Too many requests" }, 429);
    }
    await next();
  });

  /* -------- auth middlewares -------- */
  const requireSession = async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const s = token && verifySession(cfg.sessionSecret, token);
    if (!s) return c.json({ error: "unauthorized", message: "Sign in with your wallet first" }, 401);
    if (s.campaignId !== (c.req.param("id") as string)) return c.json({ error: "unauthorized", message: "Session is for a different campaign" }, 401);
    c.set("session", s);
    await next();
  };
  const requireApiKey =
    (scope: "admin" | "read") =>
    async (c: Context<AppEnv>, next: () => Promise<void>) => {
      const key = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (!key) return c.json({ error: "unauthorized", message: "API key required" }, 401);
      if (cfg.adminApiKey && safeEqual(key, cfg.adminApiKey)) {
        c.set("apiKeyScopes", ["admin", "read"]);
        return next();
      }
      const h = sha256Hex(key);
      const k = (await cfg.storage.listApiKeys()).find((k) => k.hash === h);
      if (!k || (scope === "admin" && !k.scopes.includes("admin"))) return c.json({ error: "forbidden", message: "Invalid API key" }, 403);
      c.set("apiKeyScopes", k.scopes);
      await next();
    };

  app.get("/health", (c) => c.json({ ok: true, modules: svc.registry.list().map((m) => m.id) }));
  app.get("/modules", (c) => c.json(svc.registry.list().map(({ configSchema: _s, ...m }) => m)));

  /* ======================= PUBLIC (widget) ======================= */
  app.get("/campaigns/:id", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const [total, eligible] = await Promise.all([cfg.storage.countEntries(campaign.id), cfg.storage.countEntries(campaign.id, { eligibleOnly: true })]);
    return c.json({ campaign: svc.publicCampaign(campaign), stats: { total, eligible } });
  });

  // Step 1: get a nonce + message to sign
  app.post("/campaigns/:id/auth/nonce", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const { wallet } = z.object({ wallet: pubkey }).parse(await c.req.json());
    const nonce = randomId(16);
    const issuedAt = new Date().toISOString();
    const statement = (campaign.requirements.find((r) => r.module === "wallet-signature")?.config as { statement?: string } | undefined)?.statement;
    const message = buildSignInMessage({ domain: cfg.domain, wallet, campaignId: campaign.id, nonce, issuedAt, statement });
    await cfg.storage.setTemp(`nonce:${campaign.id}:${wallet}:${nonce}`, message, 300);
    return c.json({ nonce, message });
  });

  // Step 2: verify signature, issue session, create entry
  app.post("/campaigns/:id/auth/verify", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const { wallet, nonce, signature } = z.object({ wallet: pubkey, nonce: z.string().min(8), signature: z.string().min(40) }).parse(await c.req.json());
    const key = `nonce:${campaign.id}:${wallet}:${nonce}`;
    const message = await cfg.storage.getTemp(key);
    if (!message) throw new AllowlistError(400, "Nonce expired — request a new one", "nonce_expired");
    if (!verifyWalletSignature(wallet, message, signature)) throw new AllowlistError(401, "Signature does not match wallet", "bad_signature");
    await cfg.storage.deleteTemp(key);
    const entry = await svc.getOrCreateEntry(campaign, wallet);
    const token = signSession(cfg.sessionSecret, { wallet, campaignId: campaign.id, exp: Date.now() + cfg.sessionTtlSeconds * 1000 });
    return c.json({ token, entry });
  });

  app.get("/campaigns/:id/me", requireSession, async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const entry = await svc.getOrCreateEntry(campaign, c.get("session").wallet);
    const links = await cfg.storage.listSocialLinksForWallet(campaign.id, entry.wallet);
    return c.json({ entry, social: links.map(({ provider, handle }) => ({ provider, handle })) });
  });

  app.post("/campaigns/:id/requirements/:key/verify", requireSession, async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const input = await c.req.json().catch(() => ({}));
    const { entry, result } = await svc.verifyRequirement(campaign, c.get("session").wallet, (c.req.param("key") as string), input, ipOf(c));
    return c.json({ entry, result });
  });

  registerOAuthRoutes(app, svc, cfg, requireSession);

  /* ======================= INTEGRATION (mint sites / scripts) ======================= */
  const lookupGuard = cfg.protectEligibilityLookup ? requireApiKey("read") : async (_c: Context<AppEnv>, n: () => Promise<void>) => n();
  app.get("/campaigns/:id/eligibility/:wallet", lookupGuard, async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const wallet = pubkey.parse(c.req.param("wallet"));
    const entries = await svc.finalEntries(campaign);
    const entry = entries.find((e) => e.wallet === wallet);
    const out: Record<string, unknown> = { wallet, eligible: entry?.eligible ?? false, allocation: entry?.allocation ?? 0, points: entry?.points ?? 0, rank: entry?.rank };
    if (campaign.merkle.enabled && entry?.eligible) {
      const tree = buildMerkleTree(entries.filter((e) => e.eligible).map((e) => e.wallet), campaign.merkle.scheme);
      out.merkle = { root: tree.root, proof: getMerkleProof(tree, wallet) };
    }
    return c.json(out);
  });

  /* ======================= ADMIN ======================= */
  const admin = new Hono<AppEnv>();
  admin.use("*", requireApiKey("admin"));

  admin.get("/campaigns", async (c) => c.json(await cfg.storage.listCampaigns()));
  admin.post("/campaigns", async (c) => c.json(await svc.saveCampaign(await c.req.json()), 201));
  admin.put("/campaigns/:id", async (c) => c.json(await svc.saveCampaign({ ...(await c.req.json()), id: (c.req.param("id") as string) })));
  admin.get("/campaigns/:id", async (c) => c.json(await svc.getCampaign((c.req.param("id") as string))));
  admin.delete("/campaigns/:id", async (c) => {
    await cfg.storage.deleteCampaign((c.req.param("id") as string));
    return c.body(null, 204);
  });

  admin.get("/campaigns/:id/stats", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const entries = await svc.finalEntries(campaign);
    const byRequirement = Object.fromEntries(campaign.requirements.map((r) => [r.key, entries.filter((e) => e.results[r.key]?.passed).length]));
    const pendingReview = entries.filter((e) => Object.values(e.results).some((r) => !r.passed && r.evidence?.pendingApproval)).length;
    return c.json({
      total: entries.length,
      eligible: entries.filter((e) => e.eligible).length,
      totalAllocation: entries.reduce((s, e) => s + e.allocation, 0),
      byRequirement,
      pendingReview,
      last24h: entries.filter((e) => Date.now() - e.createdAt < 86_400_000).length,
    });
  });

  admin.get("/campaigns/:id/entries", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const q = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(500).default(50), eligible: z.enum(["true", "false"]).optional(), search: z.string().optional() }).parse(c.req.query());
    let entries = await svc.finalEntries(campaign);
    if (q.eligible) entries = entries.filter((e) => e.eligible === (q.eligible === "true"));
    if (q.search) entries = entries.filter((e) => e.wallet.includes(q.search!) || e.referralCode === q.search!.toUpperCase());
    const total = entries.length;
    return c.json({ total, page: q.page, limit: q.limit, entries: entries.slice((q.page - 1) * q.limit, q.page * q.limit) });
  });

  admin.patch("/campaigns/:id/entries/:wallet/requirements/:key", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const { passed, note } = z.object({ passed: z.boolean(), note: z.string().optional() }).parse(await c.req.json());
    return c.json(await svc.overrideRequirement(campaign, c.req.param("wallet"), (c.req.param("key") as string), passed, note));
  });

  admin.post("/campaigns/:id/recheck", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const { wallets } = z.object({ wallets: z.array(pubkey).optional() }).parse(await c.req.json().catch(() => ({})));
    return c.json(await svc.recheckCampaign(campaign, wallets));
  });

  admin.get("/campaigns/:id/export", async (c) => {
    const campaign = await svc.getCampaign((c.req.param("id") as string));
    const q = z.object({ format: z.enum(["csv", "json", "txt", "merkle"]).default("json"), all: z.enum(["true", "false"]).default("false"), evidence: z.enum(["true", "false"]).default("false") }).parse(c.req.query());
    const entries = await svc.finalEntries(campaign);
    const opts = { eligibleOnly: q.all !== "true", includeEvidence: q.evidence === "true" };
    await svc.events.emit("campaign.exported", campaign.id, { format: q.format, count: entries.filter((e) => e.eligible).length });
    const fname = `${campaign.id}-allowlist`;
    if (q.format === "csv") return c.body(toCSV(toRows(campaign, entries, opts)), 200, { "content-type": "text/csv", "content-disposition": `attachment; filename="${fname}.csv"` });
    if (q.format === "txt") return c.body(toWalletList(entries), 200, { "content-type": "text/plain", "content-disposition": `attachment; filename="${fname}.txt"` });
    if (q.format === "merkle") {
      const eligible = entries.filter((e) => e.eligible).map((e) => e.wallet);
      if (eligible.length === 0) throw new AllowlistError(400, "No eligible wallets yet", "empty");
      const tree = buildMerkleTree(eligible, campaign.merkle.scheme);
      return c.json({ scheme: tree.scheme, root: tree.root, count: eligible.length, proofs: Object.fromEntries(eligible.map((w) => [w, getMerkleProof(tree, w)])) });
    }
    return c.json(toJSON(campaign, entries, { ...opts, includeMerkle: campaign.merkle.enabled }));
  });

  admin.get("/webhooks", async (c) => c.json((await cfg.storage.listWebhooks()).map(({ secret: _s, ...w }) => w)));
  admin.post("/webhooks", async (c) => {
    const body = z.object({ url: z.string().url(), events: z.array(z.string()).default(["*"]), campaignId: z.string().optional() }).parse(await c.req.json());
    const w = { id: randomId(8), secret: randomId(24), active: true, createdAt: Date.now(), ...body };
    await cfg.storage.putWebhook(w);
    return c.json(w, 201); // secret returned once
  });
  admin.delete("/webhooks/:id", async (c) => {
    await cfg.storage.deleteWebhook((c.req.param("id") as string));
    return c.body(null, 204);
  });
  admin.post("/webhooks/:id/test", async (c) => {
    const w = (await cfg.storage.listWebhooks()).find((w) => w.id === (c.req.param("id") as string));
    if (!w) throw new AllowlistError(404, "Webhook not found");
    await svc.events.deliver(w.id, w.url, w.secret, { id: randomId(8), type: "entry.updated", campaignId: w.campaignId ?? "test", data: { test: true }, createdAt: Date.now() }, 1);
    return c.json({ ok: true });
  });

  admin.get("/api-keys", async (c) => c.json((await cfg.storage.listApiKeys()).map(({ hash: _h, ...k }) => k)));
  admin.post("/api-keys", async (c) => {
    const { label, scopes } = z.object({ label: z.string().min(1), scopes: z.array(z.enum(["admin", "read"])).default(["read"]) }).parse(await c.req.json());
    const key = `al_${randomId(24)}`;
    const k = { id: randomId(6), hash: sha256Hex(key), label, scopes, createdAt: Date.now() };
    await cfg.storage.putApiKey(k);
    return c.json({ id: k.id, label, scopes, key }, 201); // key returned once
  });
  admin.delete("/api-keys/:id", async (c) => {
    await cfg.storage.deleteApiKey((c.req.param("id") as string));
    return c.body(null, 204);
  });

  app.route("/admin", admin);

  return { app, service: svc, config: cfg };
}
