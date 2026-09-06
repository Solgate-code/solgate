import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import bs58 from "bs58";
import { createAllowlistApp } from "./app.js";
import { MemoryStorage } from "./storage/memory.js";
import { verifyMerkleProof } from "@solgate/core";

(ed.etc as { sha512Sync?: (...m: Uint8Array[]) => Uint8Array }).sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const ADMIN = "test-admin-key";
const { app } = createAllowlistApp({
  storage: new MemoryStorage(),
  baseUrl: "http://localhost:8787",
  sessionSecret: "x".repeat(40),
  adminApiKey: ADMIN,
  solana: { rpcUrl: "http://127.0.0.1:1" },
  rateLimit: { windowSeconds: 60, max: 0 },
});

const json = (path: string, init: RequestInit = {}, headers: Record<string, string> = {}) =>
  Promise.resolve(app.request(path, { ...init, headers: { "content-type": "application/json", ...headers } })).then(async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any }));

const campaign = {
  id: "genesis",
  name: "Genesis Mint",
  type: "nft-mint",
  merkle: { enabled: true, scheme: "candy-guard" },
  allocation: { mode: "tiered", tiers: [{ minPoints: 0, allocation: 1 }, { minPoints: 3, allocation: 2 }] },
  requirements: [
    { key: "sig", module: "wallet-signature", config: {} },
    { key: "quiz", module: "quiz", points: 3, config: { passScore: 1, questions: [{ id: "q1", prompt: "2+2?", type: "single", options: ["3", "4"], answer: 1 }] } },
    { key: "ref", module: "referral", required: false, config: { referrerPoints: 2 } },
  ],
};

async function walletSession(campaignId: string) {
  const priv = ed.utils.randomPrivateKey();
  const wallet = bs58.encode(ed.getPublicKey(priv));
  const n = await json(`/campaigns/${campaignId}/auth/nonce`, { method: "POST", body: JSON.stringify({ wallet }) });
  expect(n.status).toBe(200);
  const sig = bs58.encode(ed.sign(new TextEncoder().encode(n.body.message), priv));
  const v = await json(`/campaigns/${campaignId}/auth/verify`, { method: "POST", body: JSON.stringify({ wallet, nonce: n.body.nonce, signature: sig }) });
  expect(v.status).toBe(200);
  return { wallet, token: v.body.token as string, entry: v.body.entry, auth: { authorization: `Bearer ${v.body.token}` } };
}

describe("end to end", () => {
  it("creates a campaign, signs in, completes requirements, exports merkle", async () => {
    expect((await json("/admin/campaigns", { method: "POST", body: JSON.stringify(campaign) })).status).toBe(401);
    const created = await json("/admin/campaigns", { method: "POST", body: JSON.stringify(campaign) }, { "x-api-key": ADMIN });
    expect(created.status).toBe(201);

    const pub = await json("/campaigns/genesis");
    expect(pub.body.campaign.requirements[1].config.questions[0].answer).toBeUndefined(); // answers stripped

    const a = await walletSession("genesis");
    expect(a.entry.results.sig.passed).toBe(true);
    expect(a.entry.eligible).toBe(false);

    // bad signature rejected
    const bad = await json("/campaigns/genesis/auth/verify", { method: "POST", body: JSON.stringify({ wallet: a.wallet, nonce: "deadbeefdeadbeef", signature: "1".repeat(88) }) });
    expect(bad.status).toBe(400);

    const wrong = await json("/campaigns/genesis/requirements/quiz/verify", { method: "POST", body: JSON.stringify({ answers: { q1: 0 } }) }, a.auth);
    expect(wrong.body.result.passed).toBe(false);
    const right = await json("/campaigns/genesis/requirements/quiz/verify", { method: "POST", body: JSON.stringify({ answers: { q1: 1 } }) }, a.auth);
    expect(right.body.result.passed).toBe(true);
    expect(right.body.entry).toMatchObject({ eligible: true, points: 3, allocation: 2 });

    // second wallet uses first wallet's referral code
    const b = await walletSession("genesis");
    const ref = await json("/campaigns/genesis/requirements/ref/verify", { method: "POST", body: JSON.stringify({ code: a.entry.referralCode }) }, b.auth);
    expect(ref.body.result.passed).toBe(true);
    const me = await json("/campaigns/genesis/me", {}, a.auth);
    expect(me.body.entry.points).toBe(5);

    // duplicate wallet → same entry, not a new one
    const stats = await json("/admin/campaigns/genesis/stats", {}, { "x-api-key": ADMIN });
    expect(stats.body).toMatchObject({ total: 2, eligible: 1 });

    const lookup = await json(`/campaigns/genesis/eligibility/${a.wallet}`);
    expect(lookup.body.eligible).toBe(true);
    expect(verifyMerkleProof(lookup.body.merkle.root, a.wallet, lookup.body.merkle.proof)).toBe(true);

    const csv = await app.request("/admin/campaigns/genesis/export?format=csv", { headers: { "x-api-key": ADMIN } });
    expect((await csv.text()).split("\n")).toHaveLength(2);
  });
});
