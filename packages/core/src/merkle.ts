import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha256";
import bs58 from "bs58";

export type MerkleScheme = "candy-guard" | "sha256-sorted";

const hashFn = (scheme: MerkleScheme) => (scheme === "candy-guard" ? keccak_256 : sha256);

function leafHash(wallet: string, scheme: MerkleScheme): Uint8Array {
  // Metaplex Candy Guard `allowList` hashes the raw 32-byte pubkey with keccak256.
  return hashFn(scheme)(bs58.decode(wallet));
}

function pairHash(a: Uint8Array, b: Uint8Array, scheme: MerkleScheme): Uint8Array {
  const [l, r] = compare(a, b) <= 0 ? [a, b] : [b, a];
  const buf = new Uint8Array(l.length + r.length);
  buf.set(l, 0);
  buf.set(r, l.length);
  return hashFn(scheme)(buf);
}

function compare(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

const hex = (u: Uint8Array) => Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from(s.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

export interface MerkleTree {
  scheme: MerkleScheme;
  root: string; // hex
  leaves: string[]; // hex, in input order
  layers: string[][];
}

/**
 * Build a sorted-pair Merkle tree compatible with Metaplex Candy Guard's allowList
 * (keccak256 leaves, sorted pair hashing, odd nodes promoted). Wallets are deduped.
 */
export function buildMerkleTree(wallets: string[], scheme: MerkleScheme = "candy-guard"): MerkleTree {
  const unique = [...new Set(wallets)];
  if (unique.length === 0) throw new Error("Cannot build a Merkle tree from zero wallets");
  const leaves = unique.map((w) => leafHash(w, scheme));
  const layers: Uint8Array[][] = [leaves];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next: Uint8Array[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? pairHash(prev[i], prev[i + 1], scheme) : prev[i]);
    }
    layers.push(next);
  }
  return {
    scheme,
    root: hex(layers[layers.length - 1][0]),
    leaves: leaves.map(hex),
    layers: layers.map((l) => l.map(hex)),
  };
}

/** Proof for a wallet as an array of hex sibling hashes (bottom → top). */
export function getMerkleProof(tree: MerkleTree, wallet: string): string[] | null {
  const leaf = hex(leafHash(wallet, tree.scheme));
  let idx = tree.leaves.indexOf(leaf);
  if (idx === -1) return null;
  const proof: string[] = [];
  for (let l = 0; l < tree.layers.length - 1; l++) {
    const layer = tree.layers[l];
    const sib = idx % 2 === 0 ? idx + 1 : idx - 1;
    if (sib < layer.length) proof.push(layer[sib]);
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export function verifyMerkleProof(root: string, wallet: string, proof: string[], scheme: MerkleScheme = "candy-guard") {
  let node = leafHash(wallet, scheme);
  for (const p of proof) node = pairHash(node, unhex(p), scheme);
  return hex(node) === root;
}

/** Root as a 32-byte array — what `@metaplex-foundation/mpl-candy-guard` expects. */
export function merkleRootBytes(tree: MerkleTree): Uint8Array {
  return unhex(tree.root);
}
