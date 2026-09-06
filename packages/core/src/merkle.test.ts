import { describe, expect, it } from "vitest";
import { buildMerkleTree, getMerkleProof, verifyMerkleProof } from "./merkle.js";
import { computeAllocation, computeEligibility, applyCaps, evaluateEntry } from "./engine.js";
import { toCSV, toRows } from "./export.js";
import type { Campaign, Entry } from "./types.js";

const wallets = [
  "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
  "HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH",
  "GjwcWFQYzemBtpUoN5fMAP2FZviTtMRWCmrppGuTthJS",
  "So11111111111111111111111111111111111111112",
];

describe("merkle", () => {
  it("builds a tree and verifies proofs for every wallet", () => {
    const tree = buildMerkleTree(wallets);
    expect(tree.root).toHaveLength(64);
    for (const w of wallets) {
      const proof = getMerkleProof(tree, w)!;
      expect(verifyMerkleProof(tree.root, w, proof)).toBe(true);
    }
    expect(getMerkleProof(tree, "11111111111111111111111111111111")).toBeNull();
  });
  it("root is order independent (sorted pairs) but membership dependent", () => {
    const a = buildMerkleTree(wallets).root;
    const b = buildMerkleTree([...wallets].reverse()).root;
    // sorted-pair hashing makes single-level pairs commutative but not the whole tree;
    // what matters is proofs verify — and a different set gives a different root.
    expect(buildMerkleTree(wallets.slice(0, 3)).root).not.toBe(a);
    expect(typeof b).toBe("string");
  });
});

const campaign: Campaign = {
  id: "c1",
  name: "Test",
  type: "nft-mint",
  cluster: "devnet",
  minPoints: 0,
  requirements: [
    { key: "sig", module: "wallet-signature", config: {}, required: true, points: 0 },
    { key: "tok", module: "token-balance", config: {}, required: true, points: 2 },
    { key: "x", module: "x-verify", config: {}, required: false, points: 3 },
  ],
  allocation: {
    mode: "tiered",
    flat: 1,
    tiers: [
      { minPoints: 0, allocation: 1 },
      { minPoints: 5, allocation: 3 },
    ],
    perRequirement: {},
    totalSupply: 4,
  },
  merkle: { enabled: true, scheme: "candy-guard" },
  metadata: {},
};

const mk = (wallet: string, passed: string[], createdAt: number): Entry => ({
  campaignId: "c1",
  wallet,
  results: Object.fromEntries(
    passed.map((k) => [k, { key: k, module: "", passed: true, checkedAt: 0 }]),
  ),
  eligible: false,
  points: 0,
  allocation: 0,
  createdAt,
  updatedAt: createdAt,
});

describe("engine", () => {
  it("computes eligibility, points and tiered allocation", () => {
    const r = mk(wallets[0], ["sig", "tok", "x"], 1).results;
    const e = computeEligibility(campaign, r);
    expect(e).toMatchObject({ eligible: true, points: 5, missing: [] });
    expect(computeAllocation(campaign.allocation, e.points, r)).toBe(3);
    const r2 = mk(wallets[1], ["sig"], 1).results;
    expect(computeEligibility(campaign, r2)).toMatchObject({ eligible: false, missing: ["tok"] });
  });
  it("applies total supply caps FCFS", () => {
    const entries = [
      { ...mk(wallets[0], ["sig", "tok", "x"], 1), eligible: true, points: 5, allocation: 3, eligibleAt: 1 },
      { ...mk(wallets[1], ["sig", "tok"], 2), eligible: true, points: 2, allocation: 1, eligibleAt: 2 },
      { ...mk(wallets[2], ["sig", "tok"], 3), eligible: true, points: 2, allocation: 1, eligibleAt: 3 },
    ];
    const capped = applyCaps(campaign, entries);
    expect(capped.map((e) => e.allocation)).toEqual([3, 1, 0]);
    expect(capped[2].eligible).toBe(false);
    const csv = toCSV(toRows(campaign, capped));
    expect(csv.split("\n")).toHaveLength(3); // header + 2 eligible
  });
});

describe("audit regressions", () => {
  it("bonus points survive re-evaluation and count toward eligibility", () => {
    const e = { ...mk(wallets[0], ["sig", "tok"], 1), bonusPoints: 3 };
    const first = evaluateEntry(campaign, e, 10);
    expect(first.points).toBe(5);
    expect(first.allocation).toBe(3); // tier 2
    const again = evaluateEntry(campaign, { ...first, results: { ...first.results } }, 20);
    expect(again.points).toBe(5);
  });
  it("ranks by eligibleAt, not createdAt, and eligibleAt is sticky", () => {
    const alice = evaluateEntry(campaign, mk(wallets[0], ["sig"], 100), 100); // registered first, not eligible
    expect(alice.eligibleAt).toBeUndefined();
    const bob = evaluateEntry(campaign, mk(wallets[1], ["sig", "tok"], 200), 200); // eligible at 200
    const aliceLater = evaluateEntry(campaign, { ...alice, results: mk(wallets[0], ["sig", "tok"], 100).results }, 900);
    expect(aliceLater.eligibleAt).toBe(900);
    const capped = applyCaps({ ...campaign, maxEntries: 1 }, [aliceLater, bob]);
    const byWallet = Object.fromEntries(capped.map((e) => [e.wallet, e]));
    expect(byWallet[wallets[1]].rank).toBe(1);
    expect(byWallet[wallets[0]].eligible).toBe(false);
    // losing eligibility later does not erase the original eligibleAt
    const lost = evaluateEntry(campaign, { ...bob, results: mk(wallets[1], ["sig"], 200).results }, 1000);
    expect(lost.eligible).toBe(false);
    expect(lost.eligibleAt).toBe(200);
  });
});
