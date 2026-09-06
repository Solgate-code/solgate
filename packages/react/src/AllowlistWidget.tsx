import { useEffect, useState, type ComponentType } from "react";
import type { Entry } from "@solana-allowlist/core";
import { useAllowlist } from "./hooks.js";
import { connectStandardWallet, listSolanaWallets, onWalletsChange, type WalletLike } from "./wallet.js";
import { pickRenderer, type ReqProps } from "./requirements/index.js";

export interface AllowlistWidgetProps {
  baseUrl: string;
  campaignId: string;
  /** Bring your own wallet (e.g. from @solana/wallet-adapter-react). Omit to use the built-in Wallet Standard picker. */
  wallet?: WalletLike | null;
  theme?: "light" | "dark";
  /** Telegram bot username, required for the Telegram module. */
  telegramBot?: string;
  /** Override or add renderers by module id. */
  renderers?: Record<string, ComponentType<ReqProps>>;
  onEligible?(entry: Entry): void;
  className?: string;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

export function AllowlistWidget({ baseUrl, campaignId, wallet: external, theme = "light", telegramBot, renderers = {}, onEligible, className }: AllowlistWidgetProps) {
  const [internal, setInternal] = useState<WalletLike | null>(null);
  const wallet = external ?? internal;
  const al = useAllowlist({ baseUrl, campaignId, wallet, onEligible });
  const { campaign, stats, entry, error, busy } = al;

  if (!campaign) {
    return (
      <div className={`sal ${className ?? ""}`} data-theme={theme}>
        <div className="sal-empty">{error ?? "Loading…"}</div>
      </div>
    );
  }

  const now = Date.now();
  const notYet = campaign.startsAt && now < Date.parse(campaign.startsAt);
  const over = campaign.endsAt && now > Date.parse(campaign.endsAt);
  const reqs = campaign.requirements.filter((r) => r.module !== "wallet-signature");
  const done = reqs.filter((r) => entry?.results[r.key]?.passed).length;

  return (
    <div className={`sal ${className ?? ""}`} data-theme={theme}>
      <header className="sal-head">
        <h2>{campaign.name}</h2>
        {campaign.description && <p>{campaign.description}</p>}
        <div className="sal-window">
          {notYet && <>Opens {new Date(campaign.startsAt!).toLocaleString()}</>}
          {over && <>Registration closed</>}
          {!notYet && !over && campaign.endsAt && <>Closes {new Date(campaign.endsAt).toLocaleString()}</>}
          {stats && <> · {stats.eligible.toLocaleString()} registered{campaign.maxEntries ? ` of ${campaign.maxEntries.toLocaleString()} spots` : ""}</>}
        </div>
      </header>

      {!entry ? (
        <WalletPicker onConnect={async (w) => { setInternal(w); await al.signIn(w); }} busy={busy === "sign-in"} external={external} />
      ) : (
        <>
          <div className="sal-rail" aria-hidden>
            {reqs.map((r) => <i key={r.key} data-on={!!entry.results[r.key]?.passed} data-optional={!r.required} />)}
          </div>
          <ol className="sal-list">
            {reqs.map((r) => {
              const result = entry.results[r.key];
              const Renderer = renderers[r.module] ?? pickRenderer(r.module);
              const state = result?.passed ? "passed" : result?.evidence?.pendingApproval ? "pending" : "todo";
              return (
                <li key={r.key} className="sal-item" data-locked={over && !result?.passed}>
                  <span className="sal-mark" data-state={state}>{state === "passed" ? "✓" : state === "pending" ? "…" : ""}</span>
                  <div className="sal-item-body">
                    <p className="sal-item-title">{r.title ?? r.label}</p>
                    {r.description && <p className="sal-item-desc">{r.description}</p>}
                    {!r.required && <p className="sal-item-meta">Optional{r.points ? ` · +${r.points} pts` : ""}</p>}
                    {r.required && r.points > 0 && <p className="sal-item-meta">+{r.points} pts</p>}
                    {result && !result.passed && result.reason && result.reason !== "opened" && <p className="sal-reason">{result.reason}</p>}
                  </div>
                  <div className="sal-item-action">
                    {!over && <Renderer req={r} result={result} busy={busy === r.key} verify={(i) => al.verify(r.key, i)} connectSocial={al.connectSocial} baseUrl={baseUrl} telegramBot={telegramBot} />}
                  </div>
                </li>
              );
            })}
          </ol>
          {error && <div className="sal-error" role="alert">{error}</div>}
          <footer className="sal-foot">
            <div>
              <div className="sal-status" data-ok={entry.eligible}>{entry.eligible ? `You're on the list` : `${done} of ${reqs.length} complete`}</div>
              <small>
                <span className="sal-addr">{short(entry.wallet)}</span>
                {entry.points > 0 && <> · {entry.points} pts</>}
                {entry.eligible && entry.allocation > 0 && <> · allocation {entry.allocation}</>}
                {entry.referralCode && <> · your code <code>{entry.referralCode}</code></>}
              </small>
            </div>
            <button className="sal-btn" data-variant="ghost" onClick={async () => { await internal?.disconnect?.(); setInternal(null); al.signOut(); }}>Switch wallet</button>
          </footer>
        </>
      )}
    </div>
  );
}

function WalletPicker({ onConnect, busy, external }: { onConnect(w: WalletLike): Promise<void>; busy: boolean; external?: WalletLike | null }) {
  const [wallets, setWallets] = useState(() => (typeof window === "undefined" ? [] : listSolanaWallets()));
  useEffect(() => onWalletsChange(() => setWallets(listSolanaWallets())), []);
  if (external === null) return <div className="sal-empty">Connect your wallet to continue.</div>;
  if (busy) return <div className="sal-empty">Sign the message in your wallet to prove ownership. No transaction, no fees.</div>;
  if (wallets.length === 0)
    return <div className="sal-empty">No Solana wallet detected. Install <a href="https://phantom.app" target="_blank" rel="noreferrer">Phantom</a>, <a href="https://solflare.com" target="_blank" rel="noreferrer">Solflare</a> or another Wallet Standard wallet, then reload.</div>;
  return (
    <div className="sal-wallets">
      {wallets.map((w) => (
        <button key={w.name} className="sal-wallet" onClick={() => connectStandardWallet(w).then(onConnect)}>
          <img src={w.icon} alt="" /> <span>{w.name}</span>
        </button>
      ))}
    </div>
  );
}
