import { useEffect, useRef, useState } from "react";
import type { RequirementResult } from "@solgate/core";
import type { PublicRequirement } from "../client.js";

export interface ReqProps {
  req: PublicRequirement;
  result?: RequirementResult;
  busy: boolean;
  verify(input?: unknown): Promise<RequirementResult | null>;
  connectSocial(provider: "x" | "discord" | "google", key: string): void;
  baseUrl: string;
  telegramBot?: string;
}

/* ---- on-chain: single "Check" button ---- */
export function OnchainReq({ req, result, busy, verify }: ReqProps) {
  if (result?.passed) return null;
  return <button className="sal-btn" disabled={busy} onClick={() => verify({})}>{busy ? "Checking…" : result ? "Check again" : "Check"}</button>;
}

/* ---- OAuth socials ---- */
const providerOf: Record<string, "x" | "discord" | "google"> = { "x-verify": "x", "discord-verify": "discord", "youtube-verify": "google" };
export function OAuthReq({ req, result, connectSocial }: ReqProps) {
  const provider = providerOf[req.module];
  if (result?.passed) return null;
  const label = provider === "x" ? "Connect X" : provider === "discord" ? "Connect Discord" : "Connect Google";
  return <button className="sal-btn" onClick={() => connectSocial(provider, req.key)}>{result ? "Retry" : label}</button>;
}

/* ---- Telegram login widget ---- */
export function TelegramReq({ req, result, verify, telegramBot }: ReqProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result?.passed || !host.current || !telegramBot) return;
    const cb = `__salTg_${req.key}`;
    (window as any)[cb] = (user: unknown) => verify(user);
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.dataset.telegramLogin = telegramBot;
    s.dataset.size = "medium";
    s.dataset.onauth = `${cb}(user)`;
    s.dataset.requestAccess = "write";
    host.current.replaceChildren(s);
    return () => { delete (window as any)[cb]; };
  }, [req.key, result?.passed, telegramBot, verify]);
  if (result?.passed) return null;
  if (!telegramBot) return <span className="sal-points">Telegram not configured</span>;
  return <div ref={host} />;
}

/* ---- generic social task ---- */
export function SocialTaskReq({ req, result, busy, verify }: ReqProps) {
  const [opened, setOpened] = useState(false);
  const [proof, setProof] = useState("");
  if (result?.passed) return null;
  const pending = result?.evidence?.pendingApproval;
  if (pending) return <span className="sal-points">Waiting for review</span>;
  return (
    <div className="sal-form" style={{ minWidth: 180 }}>
      <a className="sal-btn" data-variant="ghost" href={req.config.url} target="_blank" rel="noreferrer noopener" onClick={() => { setOpened(true); verify({ action: "open" }); }}>
        {req.config.label}
      </a>
      {opened && req.config.requireProofUrl && <input className="sal-input" placeholder="Link to your post" value={proof} onChange={(e) => setProof(e.target.value)} />}
      {opened && <button className="sal-btn" disabled={busy} onClick={() => verify({ action: "complete", proofUrl: proof || undefined })}>Mark done</button>}
    </div>
  );
}

/* ---- quiz ---- */
export function QuizReq({ req, result, busy, verify }: ReqProps) {
  const [answers, setAnswers] = useState<Record<string, number | number[] | string>>({});
  const [open, setOpen] = useState(false);
  if (result?.passed) return null;
  if (!open) return <button className="sal-btn" onClick={() => setOpen(true)}>{result ? "Try again" : "Start"}</button>;
  const qs = req.config.questions as { id: string; prompt: string; type: string; options?: string[] }[];
  return (
    <form className="sal-form" style={{ gridColumn: "1 / -1", minWidth: 260 }} onSubmit={(e) => { e.preventDefault(); verify({ answers }); }}>
      {qs.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.prompt}</legend>
          {q.type === "text" && <input className="sal-input" value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />}
          {q.type !== "text" && q.options?.map((o, i) => (
            <label key={i}>
              <input
                type={q.type === "multi" ? "checkbox" : "radio"}
                name={q.id}
                checked={q.type === "multi" ? ((answers[q.id] as number[]) ?? []).includes(i) : answers[q.id] === i}
                onChange={() => {
                  if (q.type === "multi") {
                    const cur = new Set((answers[q.id] as number[]) ?? []);
                    cur.has(i) ? cur.delete(i) : cur.add(i);
                    setAnswers({ ...answers, [q.id]: [...cur] });
                  } else setAnswers({ ...answers, [q.id]: i });
                }}
              />
              {o}
            </label>
          ))}
        </fieldset>
      ))}
      <button className="sal-btn" disabled={busy} type="submit">Submit answers</button>
    </form>
  );
}

/* ---- referral ---- */
export function ReferralReq({ req, result, busy, verify }: ReqProps) {
  const [code, setCode] = useState("");
  if (result?.passed) return null;
  return (
    <form className="sal-ref" onSubmit={(e) => { e.preventDefault(); verify({ code }); }}>
      <input className="sal-input" style={{ width: 130, textTransform: "uppercase" }} placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} />
      <button className="sal-btn" disabled={busy || (!code && req.config.requireCode)} type="submit">{code ? "Apply" : "Skip"}</button>
    </form>
  );
}

/* ---- captcha ---- */
declare global { interface Window { turnstile?: any; hcaptcha?: any; grecaptcha?: any; } }
export function CaptchaReq({ req, result, verify }: ReqProps) {
  const host = useRef<HTMLDivElement>(null);
  const { provider, siteKey } = req.config as { provider: "turnstile" | "hcaptcha" | "recaptcha"; siteKey: string };
  useEffect(() => {
    if (result?.passed || !host.current) return;
    const el = host.current;
    const srcs = {
      turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      hcaptcha: "https://js.hcaptcha.com/1/api.js?render=explicit",
      recaptcha: `https://www.google.com/recaptcha/api.js?render=${siteKey}`,
    };
    const load = () =>
      new Promise<void>((res) => {
        if (document.querySelector(`script[src="${srcs[provider]}"]`)) return res();
        const s = document.createElement("script");
        s.src = srcs[provider];
        s.async = true;
        s.onload = () => res();
        document.head.appendChild(s);
      });
    load().then(() => {
      const wait = setInterval(() => {
        const api = provider === "turnstile" ? window.turnstile : provider === "hcaptcha" ? window.hcaptcha : window.grecaptcha;
        if (!api) return;
        clearInterval(wait);
        if (provider === "recaptcha") api.ready(() => api.execute(siteKey, { action: "allowlist" }).then((token: string) => verify({ token })));
        else api.render(el, { sitekey: siteKey, callback: (token: string) => verify({ token }) });
      }, 100);
    });
  }, [provider, siteKey, result?.passed, verify]);
  if (result?.passed) return null;
  return <div ref={host} style={{ gridColumn: "1 / -1" }} />;
}

export function pickRenderer(module: string) {
  switch (module) {
    case "wallet-signature": return () => null;
    case "token-balance":
    case "nft-ownership": return OnchainReq;
    case "x-verify":
    case "discord-verify":
    case "youtube-verify": return OAuthReq;
    case "telegram-verify": return TelegramReq;
    case "social-task": return SocialTaskReq;
    case "quiz": return QuizReq;
    case "referral": return ReferralReq;
    case "captcha": return CaptchaReq;
    default: return OnchainReq; // custom modules: a plain "Check" button posting {} — override via `renderers` prop
  }
}
