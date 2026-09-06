/**
 * Minimal Wallet Standard integration so the widget works with Phantom,
 * Solflare, Backpack… with zero extra dependencies. If you already use
 * @solana/wallet-adapter-react, pass its `publicKey`/`signMessage` via the
 * `wallet` prop instead and this file is unused.
 */
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import bs58 from "bs58";

export interface WalletLike {
  address: string;
  signMessage(message: Uint8Array): Promise<Uint8Array>;
  disconnect?(): Promise<void>;
  name?: string;
  icon?: string;
}

const SOLANA_CHAIN = "solana:";
const isSolanaWallet = (w: Wallet) => w.chains.some((c) => c.startsWith(SOLANA_CHAIN)) && "standard:connect" in w.features && "solana:signMessage" in w.features;

export function listSolanaWallets(): Wallet[] {
  return getWallets().get().filter(isSolanaWallet);
}

export function onWalletsChange(cb: () => void) {
  const { on } = getWallets();
  const offs = [on("register", cb), on("unregister", cb)];
  return () => offs.forEach((o) => o());
}

export async function connectStandardWallet(w: Wallet): Promise<WalletLike> {
  const connect = (w.features as any)["standard:connect"].connect as () => Promise<{ accounts: readonly WalletAccount[] }>;
  const { accounts } = await connect();
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith(SOLANA_CHAIN))) ?? accounts[0];
  if (!account) throw new Error("No Solana account returned by wallet");
  const sign = (w.features as any)["solana:signMessage"].signMessage as (i: { account: WalletAccount; message: Uint8Array }) => Promise<{ signature: Uint8Array }[]>;
  const disconnect = (w.features as any)["standard:disconnect"]?.disconnect as (() => Promise<void>) | undefined;
  return {
    address: bs58.encode(new Uint8Array(account.publicKey)),
    name: w.name,
    icon: w.icon,
    signMessage: async (message) => (await sign({ account, message }))[0].signature,
    disconnect,
  };
}

export const encodeSignature = (s: Uint8Array) => bs58.encode(s);
