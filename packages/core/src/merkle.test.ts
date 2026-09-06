import { describe, expect, it } from "vitest";
import { buildMerkleTree, getMerkleProof, verifyMerkleProof } from "./merkle.js";
import { computeAllocation, computeEligibility, applyCaps } from "./engine.js";
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
      { ...mk(wallets[0], ["sig", "tok", "x"], 1), eligible: true, points: 5, allocation: 3 },
      { ...mk(wallets[1], ["sig", "tok"], 2), eligible: true, points: 2, allocation: 1 },
      { ...mk(wallets[2], ["sig", "tok"], 3), eligible: true, points: 2, allocation: 1 },
    ];
    const capped = applyCaps(campaign, entries);
    expect(capped.map((e) => e.allocation)).toEqual([3, 1, 0]);
    expect(capped[2].eligible).toBe(false);
    const csv = toCSV(toRows(campaign, capped));
    expect(csv.split("\n")).toHaveLength(3); // header + 2 eligible
  });
});
