import { z } from "zod";
import { NftOwnershipModule, TokenBalanceModule, WalletSignatureModule } from "@solana-allowlist/core";
import { fail, pass, type Verifier } from "./types.js";

type TokenCfg = z.infer<typeof TokenBalanceModule.configSchema>;
type NftCfg = z.infer<typeof NftOwnershipModule.configSchema>;

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result as T;
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Wallet signature is verified at session creation; this verifier just records it. */
export const walletSignatureVerifier: Verifier = {
  moduleId: WalletSignatureModule.id,
  async verify({ requirement, entry }) {
    return pass(requirement.key, requirement.module, { wallet: entry.wallet });
  },
};

export const tokenBalanceVerifier: Verifier<TokenCfg> = {
  moduleId: TokenBalanceModule.id,
  async verify({ requirement, config, wallet, cfg }) {
    let total = 0;
    for (const programId of [TOKEN_PROGRAM, TOKEN_2022]) {
      const r = await rpc<{ value: { account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }[] }>(
        cfg.solana.rpcUrl,
        "getTokenAccountsByOwner",
        [wallet, { mint: config.mint, programId }, { encoding: "jsonParsed" }],
      ).catch(() => ({ value: [] }));
      for (const acc of r.value) {
        total += acc.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
        if (!config.includeAllAccounts) break;
      }
    }
    const evidence = { mint: config.mint, balance: total, required: config.min };
    return total >= config.min
      ? pass(requirement.key, requirement.module, evidence)
      : fail(requirement.key, requirement.module, `Need at least ${config.min}, found ${total}`, evidence);
  },
};

interface DasAsset {
  id: string;
  grouping?: { group_key: string; group_value: string; verified?: boolean }[];
  creators?: { address: string; verified: boolean }[];
  burnt?: boolean;
  interface?: string;
}

/** NFT ownership via DAS `getAssetsByOwner` (covers Token Metadata, Core, and compressed NFTs). */
export const nftOwnershipVerifier: Verifier<NftCfg> = {
  moduleId: NftOwnershipModule.id,
  async verify({ requirement, config, wallet, cfg }) {
    const matches: string[] = [];
    let page = 1;
    while (page <= 10) {
      const r = await rpc<{ items: DasAsset[]; total: number }>(cfg.solana.dasUrl!, "getAssetsByOwner", [
        { ownerAddress: wallet, page, limit: 1000, displayOptions: { showCollectionMetadata: false } },
      ]);
      for (const a of r.items) {
        if (a.burnt) continue;
        const inCollection =
          config.collection && a.grouping?.some((g) => g.group_key === "collection" && g.group_value === config.collection && g.verified !== false);
        const inMints = config.mints?.includes(a.id);
        const byCreator = config.creator && a.creators?.some((c) => c.address === config.creator && c.verified);
        if (inCollection || inMints || byCreator) matches.push(a.id);
      }
      if (r.items.length < 1000) break;
      page++;
    }
    const evidence = { matched: matches.slice(0, 50), count: matches.length, required: config.min };
    return matches.length >= config.min
      ? pass(requirement.key, requirement.module, evidence)
      : fail(requirement.key, requirement.module, `Need ${config.min} qualifying NFT(s), found ${matches.length}`, evidence);
  },
};
