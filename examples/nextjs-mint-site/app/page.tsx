"use client";
/**
 * Minimal Next.js page embedding the widget with wallet-adapter as the wallet source.
 * pnpm add @solana-allowlist/react @solana/wallet-adapter-react @solana/wallet-adapter-react-ui
 */
import { useMemo } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AllowlistWidget, type WalletLike } from "@solana-allowlist/react";
import "@solana-allowlist/react/styles.css";

export default function Page() {
  const { publicKey, signMessage, disconnect } = useWallet();
  const wallet = useMemo<WalletLike | null>(
    () => (publicKey && signMessage ? { address: publicKey.toBase58(), signMessage, disconnect } : null),
    [publicKey, signMessage, disconnect],
  );
  return (
    <main style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <WalletMultiButton />
      <div style={{ height: 16 }} />
      <AllowlistWidget
        baseUrl={process.env.NEXT_PUBLIC_ALLOWLIST_API!}
        campaignId="genesis-mint"
        wallet={wallet}
        theme="dark"
        onEligible={() => console.log("eligible!")}
      />
    </main>
  );
}
