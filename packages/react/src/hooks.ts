import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Entry } from "@solana-allowlist/core";
import { AllowlistClient, type PublicCampaign } from "./client.js";
import { encodeSignature, type WalletLike } from "./wallet.js";

export interface UseAllowlistOptions {
  baseUrl: string;
  campaignId: string;
  /** Provide your own wallet (e.g. from wallet-adapter). */
  wallet?: WalletLike | null;
  onEligible?(entry: Entry): void;
}

export function useAllowlist({ baseUrl, campaignId, wallet, onEligible }: UseAllowlistOptions) {
  const client = useMemo(() => new AllowlistClient(baseUrl, campaignId), [baseUrl, campaignId]);
  const [campaign, setCampaign] = useState<PublicCampaign | null>(null);
  const [stats, setStats] = useState<{ total: number; eligible: number } | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [social, setSocial] = useState<{ provider: string; handle?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const wasEligible = useRef(false);

  useEffect(() => {
    client.getCampaign().then((r) => { setCampaign(r.campaign); setStats(r.stats); }).catch((e) => setError(e.message));
  }, [client]);

  const refresh = useCallback(async () => {
    if (!client.token) return;
    try {
      const r = await client.me();
      setEntry(r.entry);
      setSocial(r.social);
    } catch {
      client.setToken(null);
      setEntry(null);
    }
  }, [client]);

  // resume session / handle OAuth return
  useEffect(() => {
    refresh();
    if (typeof location !== "undefined") {
      const u = new URL(location.href);
      const flag = u.searchParams.get("allowlist");
      if (flag) {
        const msg = u.searchParams.get("allowlist_msg");
        if (flag.endsWith(":error") && msg) setError(msg);
        u.searchParams.delete("allowlist");
        u.searchParams.delete("allowlist_msg");
        history.replaceState(null, "", u.toString());
      }
    }
  }, [refresh]);

  useEffect(() => {
    if (entry?.eligible && !wasEligible.current) onEligible?.(entry);
    wasEligible.current = !!entry?.eligible;
  }, [entry, onEligible]);

  const signIn = useCallback(async (w: WalletLike) => {
    setBusy("sign-in");
    setError(null);
    try {
      const e = await client.signIn(w.address, w.signMessage, encodeSignature);
      setEntry(e);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, [client, refresh]);

  // auto sign-in when a wallet is supplied by the host
  useEffect(() => {
    if (wallet && !client.token && !busy) signIn(wallet);
  }, [wallet, client, busy, signIn]);

  const verify = useCallback(async (key: string, input?: unknown) => {
    setBusy(key);
    setError(null);
    try {
      const r = await client.verify(key, input);
      setEntry(r.entry);
      return r.result;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  }, [client]);

  const connectSocial = useCallback(async (provider: "x" | "discord" | "google", key: string) => {
    setError(null);
    try {
      const { url } = await client.oauthUrl(provider, key);
      location.assign(url);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [client]);

  const signOut = useCallback(() => {
    client.setToken(null);
    setEntry(null);
    setSocial([]);
  }, [client]);

  return { client, campaign, stats, entry, social, error, busy, signIn, signOut, verify, connectSocial, refresh, setError };
}
