import { afterEach, describe, expect, it, vi } from "vitest";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import bs58 from "bs58";
import { createAllowlistApp } from "./app.js";
import { MemoryStorage } from "./storage/memory.js";
import { createSqliteStorage } from "./storage/sqlite.js";
import { verifyTelegramLogin } from "./verifiers/social.js";
import { toRawAmount } from "./verifiers/onchain.js";
import { assertSafeWebhookUrl } from "./webhooks.js";
import { resolveReturnUrl } from "./routes/oauth.js";
import { normalizeConfig } from "./config.js";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
import { sha256Hex } from "./crypto.js";

(ed.etc as { sha512Sync?: (...m: Uint8Array[]) => Uint8Array }).sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const ADMIN = "k";
function makeApp(storage = new MemoryStorage(), extra: Record<string, unknown> = {}) {
  return createAllowlistApp({
    storage,
    baseUrl: "https://api.example.com",
    corsOrigins: ["https://myproject.xyz"],
    sessionSecret: "x".repeat(40),
    adminApiKey: ADMIN,
    solana: { rpcUrl: "https://rpc.invalid" },
    rateLimit: { windowSeconds: 60, max: 0 },
    ...extra,
  });
}
const j = (app: ReturnType<typeof makeApp>["app"], path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  Promise.resolve(app.request(path, { ...init, headers: { "content-type": "application/json", ...headers } })).then(async (r: Response) => ({ status: r.status, body: (await r.json().catch(() => null)) as any }));

async function session(app: ReturnType<typeof makeApp>["app"], id: string) {
  const priv = ed.utils.randomPrivateKey();
  const wallet = bs58.encode(ed.getPublicKey(priv));
  const n = await j(app, `/campaigns/${id}/auth/nonce`, { method: "POST", body: JSON.stringify({ wallet }) });
  const sig = bs58.encode(ed.sign(new TextEncoder().encode(n.body.message), priv));
  const v = await j(app, `/campaigns/${id}/auth/verify`, { method: "POST", body: JSON.stringify({ wallet, nonce: n.body.nonce, signature: sig }) });
  return { wallet, entry: v.body.entry, auth: { authorization: `Bearer ${v.body.token}` } };
}

const campaign = {
  id: "c",
  name: "C",
  merkle: { enabled: true },
  allocation: { mode: "tiered", tiers: [{ minPoints: 0, allocation: 1 }, { minPoints: 4, allocation: 2 }] },
  requirements: [
    { key: "sig", module: "wallet-signature", config: {} },
    { key: "tok", module: "token-balance", config: { mint: "So11111111111111111111111111111111111111112", min: 1.5 } },
    { key: "quiz", module: "quiz", required: false, points: 2, config: { questions: [{ id: "q", prompt: "?", options: ["a", "b"], answer: 1 }] } },
    { key: "ref", module: "referral", required: false, config: { referrerPoints: 2, maxReferrals: 1 } },
  ],
};
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const withSecret = { ...campaign, requirements: [...campaign.requirements, { key: "secret", module: "custom-secret", required: false, config: { apiSecret: "SHOULD-NOT-LEAK" } }] };

afterEach(() => vi.restoreAllMocks());

describe("H1 token balance", () => {
  it("scales UI amounts to raw integers exactly", () => {
    expect(toRawAmount(1.5, 9)).toBe(1_500_000_000n);
    expect(toRawAmount("0.1", 6)).toBe(100_000n);
    expect(toRawAmount("123456789.123456789", 9)).toBe(123456789123456789n);
    expect(toRawAmount(1, 0)).toBe(1n);
  });
  it("queries by mint only, compares raw amounts, and does not persist a result when RPC is down", async () => {
    const { app } = makeApp();
    await j(app, "/admin/campaigns", { method: "POST", body: JSON.stringify(campaign) }, { "x-api-key": ADMIN });
    const s = await session(app, "c");
    const calls: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.params);
      if (calls.length === 1) return new Response("boom", { status: 500 });
      return Response.json({ jsonrpc: "2.0", id: 1, result: { value: [
        { account: { data: { parsed: { info: { tokenAmount: { amount: "1000000000", decimals: 9 } } } } } },
        { account: { data: { parsed: { info: { tokenAmount: { amount: "500000000", decimals: 9 } } } } } },
      ] } });
    });
    const down = await j(app, "/campaigns/c/requirements/tok/verify", { method: "POST", body: "{}" }, s.auth);
    expect(down.status).toBe(503);
    const me = await j(app, "/campaigns/c/me", {}, s.auth);
    expect(me.body.entry.results.tok).toBeUndefined(); // nothing recorded
    const ok = await j(app, "/campaigns/c/requirements/tok/verify", { method: "POST", body: "{}" }, s.auth);
    expect(calls[1][1]).toEqual({ mint: campaign.requirements[1].config.mint }); // no programId
    expect(ok.body.result.passed).toBe(true); // 1.0 + 0.5 == 1.5 exactly
  });
});

describe("H2 social uniqueness is atomic", () => {
  it("sqlite: second wallet claiming the same identity is rejected, not overwritten", async () => {
    const storage = await createSqliteStorage(":memory:");
    const link = (wallet: string) => ({ campaignId: "c", provider: "x", providerUserId: "42", wallet, createdAt: 1 });
    const results = await Promise.all([storage.claimSocialLink(link("A")), storage.claimSocialLink(link("B"))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await storage.getSocialLink("c", "x", "42"))!.wallet).toBe(results[0].ok ? "A" : "B");
    expect(await storage.claimSocialLink(link("A"))).toEqual(results[0].ok ? { ok: true } : { ok: false, owner: "B" });
  });
  it("sqlite: incrTemp is a single atomic upsert", async () => {
    const storage = await createSqliteStorage(":memory:");
    const vals = await Promise.all(Array.from({ length: 20 }, () => storage.incrTemp("k", 60)));
    expect(new Set(vals).size).toBe(20);
    expect(Math.max(...vals)).toBe(20);
  });
});

describe("H3 referral points persist", () => {
  it("referrer keeps bonus points after later re-evaluation, and caps are enforced", async () => {
    const { app } = makeApp();
    await j(app, "/admin/campaigns", { method: "POST", body: JSON.stringify(campaign) }, { "x-api-key": ADMIN });
    const a = await session(app, "c");
    const b = await session(app, "c");
    const c2 = await session(app, "c");
    expect((await j(app, "/campaigns/c/requirements/ref/verify", { method: "POST", body: JSON.stringify({ code: a.entry.referralCode }) }, b.auth)).body.result.passed).toBe(true);
    expect((await j(app, "/campaigns/c/requirements/ref/verify", { method: "POST", body: JSON.stringify({ code: a.entry.referralCode }) }, c2.auth)).body.result.passed).toBe(true); // over cap: no points
    let me = await j(app, "/campaigns/c/me", {}, a.auth);
    expect(me.body.entry.bonusPoints).toBe(2);
    expect(me.body.entry.points).toBe(2);
    // a completes the quiz → re-evaluation must keep the 2 bonus points
    const q = await j(app, "/campaigns/c/requirements/quiz/verify", { method: "POST", body: JSON.stringify({ answers: { q: 1 } }) }, a.auth);
    expect(q.body.entry.points).toBe(4);
  });
});

describe("M5 OAuth return URL", () => {
  const cfg = normalizeConfig({ storage: new MemoryStorage(), baseUrl: "https://api.example.com", corsOrigins: ["https://myproject.xyz"], sessionSecret: "x".repeat(40), solana: { rpcUrl: "x" } });
  it("allows relative, own origin and CORS origins; rejects everything else", () => {
    expect(resolveReturnUrl("/done", cfg)!.href).toBe("https://api.example.com/done");
    expect(resolveReturnUrl("https://myproject.xyz/mint?x=1", cfg)!.origin).toBe("https://myproject.xyz");
    expect(resolveReturnUrl("https://evil.example/", cfg)).toBeNull();
    expect(resolveReturnUrl("//evil.example/", cfg)).toBeNull();
    expect(resolveReturnUrl("javascript:alert(1)", cfg)).toBeNull();
  });
});

describe("M6 config is private by default", () => {
  it("custom module without publicConfig exposes {} to the browser", async () => {
    const { app } = makeApp(new MemoryStorage(), {
      registry: new (await import("@solgate/core")).ModuleRegistry().register({ id: "custom-secret", label: "S", category: "custom", configSchema: (await import("zod")).z.object({ apiSecret: (await import("zod")).z.string() }) }),
    });
    expect((await j(app, "/admin/campaigns", { method: "POST", body: JSON.stringify(withSecret) }, { "x-api-key": ADMIN })).status).toBe(201);
    const pub = await j(app, "/campaigns/c");
    const reqs = Object.fromEntries(pub.body.campaign.requirements.map((r: any) => [r.key, r.config]));
    expect(reqs.secret).toEqual({});
    expect(reqs.quiz.questions[0].answer).toBeUndefined();
    expect(reqs.tok).toEqual({ mint: campaign.requirements[1].config.mint, min: 1.5 });
    expect(JSON.stringify(pub.body)).not.toContain("SHOULD-NOT-LEAK");
  });
});

describe("M7 proxy headers", () => {
  it("ignores x-forwarded-for unless trustProxy says so", async () => {
    const seen: string[] = [];
    const { app } = makeApp(new MemoryStorage(), { rateLimit: { windowSeconds: 60, max: 2 }, trustProxy: "none" });
    for (let i = 0; i < 5; i++) seen.push(String((await j(app, "/health", {}, { "x-forwarded-for": `1.1.1.${i}` })).status));
    expect(seen).toEqual(["200", "200", "200", "200", "200"]); // no socket ip → no limiting, and spoofed header ignored
    const { app: app2 } = makeApp(new MemoryStorage(), { rateLimit: { windowSeconds: 60, max: 2 }, trustProxy: "x-forwarded-for" });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await j(app2, "/health", {}, { "x-forwarded-for": "9.9.9.9" })).status);
    expect(codes).toEqual([200, 200, 429]);
  });
});

describe("L12 telegram timestamps", () => {
  const token = "123:ABC";
  const sign = (data: Record<string, unknown>) => {
    const check = Object.keys(data).sort().map((k) => `${k}=${data[k]}`).join("\n");
    const key = Uint8Array.from(sha256Hex(token).match(/.{2}/g)!.map((h) => parseInt(h, 16)));
    return Array.from(hmac(sha256, key, new TextEncoder().encode(check)), (b) => b.toString(16).padStart(2, "0")).join("");
  };
  it("rejects stale and future auth_date, accepts fresh", () => {
    const now = Math.floor(Date.now() / 1000);
    const fresh = { id: 1, auth_date: now - 10 };
    expect(verifyTelegramLogin(token, { ...fresh, hash: sign(fresh) })).toBe(true);
    const future = { id: 1, auth_date: now + 3600 };
    expect(verifyTelegramLogin(token, { ...future, hash: sign(future) })).toBe(false);
    const stale = { id: 1, auth_date: now - 100000 };
    expect(verifyTelegramLogin(token, { ...stale, hash: sign(stale) })).toBe(false);
    expect(verifyTelegramLogin(token, { ...fresh, hash: "00" })).toBe(false);
  });
});

describe("L13/L14 eligibility exposure + snapshots", () => {
  it("minimal mode hides points/rank; snapshot pins the root", async () => {
    const { app } = makeApp();
    await j(app, "/admin/campaigns", { method: "POST", body: JSON.stringify({ ...campaign, requirements: campaign.requirements.filter((r) => r.key !== "tok" && r.key !== "secret") }) }, { "x-api-key": ADMIN });
    const a = await session(app, "c");
    const live = await j(app, `/campaigns/c/eligibility/${a.wallet}`);
    expect(live.body).toMatchObject({ eligible: true, allocation: 1, snapshot: null });
    expect(live.body.points).toBeUndefined();
    expect(live.body.merkle.proof).toEqual([]);
    const withKey = await j(app, `/campaigns/c/eligibility/${a.wallet}`, {}, { "x-api-key": ADMIN });
    expect(withKey.body.rank).toBe(1);

    const snap = await j(app, "/admin/campaigns/c/snapshot", { method: "POST" }, { "x-api-key": ADMIN });
    expect(snap.status).toBe(201);
    const b = await session(app, "c"); // eligible now, but not in the snapshot
    const fromSnap = await j(app, `/campaigns/c/eligibility/${b.wallet}`);
    expect(fromSnap.body).toMatchObject({ eligible: false, snapshot: snap.body.id });
    const aSnap = await j(app, `/campaigns/c/eligibility/${a.wallet}`);
    expect(aSnap.body.merkle.root).toBe(snap.body.merkle.root);
  });
});

describe("L15 webhook SSRF", () => {
  it("rejects internal and non-https targets", () => {
    for (const bad of ["http://example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://169.254.169.254/latest", "https://10.0.0.5/h", "https://192.168.1.1/", "https://172.16.0.1/", "https://[::1]/", "file:///etc/passwd"])
      expect(() => assertSafeWebhookUrl(bad), bad).toThrow();
    expect(assertSafeWebhookUrl("https://hooks.example.com/x").hostname).toBe("hooks.example.com");
    expect(assertSafeWebhookUrl("http://localhost:3000/x", { allowInsecure: true }).port).toBe("3000");
  });
});
