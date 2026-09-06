import { z } from "zod";
import { NftOwnershipModule, TokenBalanceModule, WalletSignatureModule } from "@solgate/core";
import { VerificationUnavailable, fail, pass, type Verifier } from "./types.js";

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

/** Scale a UI amount (e.g. 12.5) to raw units as a BigInt, exactly. */
export function toRawAmount(ui: number | string, decimals: number): bigint {
  const [int, frac = ""] = String(ui).split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(int || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
}

/** Wallet signature is verified at session creation; this verifier just records it. */
export const walletSignatureVerifier: Verifier = {
  moduleId: WalletSignatureModule.id,
  async verify({ requirement, entry }) {
    return pass(requirement.key, requirement.module, { wallet: entry.wallet });
  },
};

interface ParsedTokenAccount {
  account: { data: { parsed: { info: { tokenAmount: { amount: string; decimals: number } } } } };
}

/**
 * SPL / Token-2022 balance. Filtering by `mint` alone returns accounts from
 * whichever token program owns that mint, so one query covers both programs.
 * Amounts are compared as exact integers (raw units), never floats.
 * RPC failures are surfaced as VerificationUnavailable — an outage must not
 * be recorded as "user has zero tokens".
 */
export const tokenBalanceVerifier: Verifier<TokenCfg> = {
  moduleId: TokenBalanceModule.id,
  async verify({ requirement, config, wallet, cfg }) {
    let r: { value: ParsedTokenAccount[] };
    try {
      r = await rpc(cfg.solana.rpcUrl, "getTokenAccountsByOwner", [wallet, { mint: config.mint }, { encoding: "jsonParsed" }]);
    } catch (e) {
      throw new VerificationUnavailable(`Could not read token balance: ${(e as Error).message}`);
    }
    let total = 0n;
    let decimals = 0;
    for (const acc of r.value) {
      const t = acc.account.data.parsed.info.tokenAmount;
      decimals = t.decimals;
      total += BigInt(t.amount);
      if (!config.includeAllAccounts) break;
    }
    const required = toRawAmount(config.min, decimals);
    const evidence = { mint: config.mint, balanceRaw: total.toString(), decimals, required: config.min, accounts: r.value.length };
    return total >= required
      ? pass(requirement.key, requirement.module, evidence)
      : fail(requirement.key, requirement.module, `Need at least ${config.min}, found ${Number(total) / 10 ** decimals}`, evidence);
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
      let r: { items: DasAsset[]; total: number };
      try {
        r = await rpc(cfg.solana.dasUrl!, "getAssetsByOwner", [{ ownerAddress: wallet, page, limit: 1000, displayOptions: { showCollectionMetadata: false } }]);
      } catch (e) {
        throw new VerificationUnavailable(`Could not read NFT holdings: ${(e as Error).message}`);
      }
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
