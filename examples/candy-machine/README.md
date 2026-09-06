# Candy Machine allowlist guard

1. Enable Merkle in your campaign config: `"merkle": { "enabled": true, "scheme": "candy-guard" }`
2. Before mint, snapshot on-chain requirements: `POST /admin/campaigns/:id/recheck`
3. Fetch the root: `GET /admin/campaigns/:id/export?format=merkle` → `{ root, proofs }`
4. Set the guard (Umi):

```ts
import { updateCandyGuard, getMerkleRoot } from "@metaplex-foundation/mpl-candy-machine";
import { publicKey, some } from "@metaplex-foundation/umi";

// `root` is hex from the export; convert to bytes
const root = Uint8Array.from(Buffer.from(exported.root, "hex"));
await updateCandyGuard(umi, {
  candyGuard: candyGuardPk,
  guards: { allowList: some({ merkleRoot: root }) },
  groups: [],
}).sendAndConfirm(umi);
```

5. At mint time your frontend fetches the wallet's proof from the public endpoint
   (`GET /campaigns/:id/eligibility/:wallet` → `merkle.proof`) and passes it to
   `route(..., { guard: "allowList", routeArgs: { path: "proof", merkleRoot: root, merkleProof: proof.map(hex => Buffer.from(hex, "hex")) } })`.

The tree uses keccak256 over the raw 32-byte pubkey with sorted-pair hashing, byte-for-byte what `getMerkleRoot`/`getMerkleProof` in `mpl-candy-machine` produce, so either side can regenerate it from the exported wallet list.
