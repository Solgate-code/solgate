import type { Context, Hono } from "hono";
import type { AppEnv } from "../app.js";
import type { AllowlistService } from "../service.js";
import type { NormalizedConfig } from "../config.js";
import { pkceChallenge, pkceVerifier, randomId } from "../crypto.js";
import type { SocialProfile } from "../verifiers/social.js";

type Provider = "x" | "discord" | "google";

interface ProviderDef {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  pkce: boolean;
  /** Basic auth on token exchange (X requires it for confidential clients). */
  basicAuth: boolean;
  profile(token: string): Promise<SocialProfile>;
}

const providers: Record<Provider, ProviderDef> = {
  x: {
    authUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scope: "tweet.read users.read follows.read",
    pkce: true,
    basicAuth: true,
    async profile(token) {
      const r = await fetch("https://api.x.com/2/users/me?user.fields=created_at,public_metrics", { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json()) as { data: { id: string; username: string; created_at?: string; public_metrics?: { followers_count: number } } };
      return { provider: "x", id: j.data.id, handle: j.data.username, accessToken: token, meta: { created_at: j.data.created_at, followers: j.data.public_metrics?.followers_count } };
    },
  },
  discord: {
    authUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/v10/oauth2/token",
    scope: "identify guilds",
    pkce: false,
    basicAuth: false,
    async profile(token) {
      const r = await fetch("https://discord.com/api/v10/users/@me", { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json()) as { id: string; username: string };
      return { provider: "discord", id: j.id, handle: j.username, accessToken: token };
    },
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid https://www.googleapis.com/auth/youtube.readonly",
    pkce: true,
    basicAuth: false,
    async profile(token) {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { authorization: `Bearer ${token}` } });
      const j = (await r.json()) as { sub: string; email?: string };
      return { provider: "google", id: j.sub, handle: j.email, accessToken: token };
    },
  },
};

const moduleForProvider: Record<Provider, string> = { x: "x-verify", discord: "discord-verify", google: "youtube-verify" };

/**
 * OAuth flow:
 *   GET  /campaigns/:id/oauth/:provider/start?key=<requirementKey>&return=<url>   (needs session)
 *   GET  /oauth/:provider/callback                                                (provider redirects here)
 * On callback we verify the requirement and redirect to `return` with ?allowlist=<key>:<ok|error>&msg=…
 */
/**
 * Only allow redirecting back to: a relative path, the API's own origin, an
 * explicitly listed CORS origin, or an explicitly allowed return origin.
 * A wildcard CORS policy never widens OAuth redirects: embedding from any
 * origin is not equivalent to trusting any origin as an authentication return
 * destination.
 */
export function resolveReturnUrl(raw: string | undefined, cfg: NormalizedConfig): URL | null {
  const base = new URL(cfg.baseUrl);
  let u: URL;
  try {
    u = new URL(raw ?? "/", base);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const corsOrigins = Array.isArray(cfg.corsOrigins) ? cfg.corsOrigins : [];
  const allowed = new Set<string>([base.origin, ...(cfg.allowedReturnOrigins ?? []), ...corsOrigins]);
  return allowed.has(u.origin) ? u : null;
}

export function registerOAuthRoutes(
  app: Hono<AppEnv>,
  svc: AllowlistService,
  cfg: NormalizedConfig,
  requireSession: (c: Context<AppEnv>, next: () => Promise<void>) => Promise<Response | void>,
) {
  app.get("/campaigns/:id/oauth/:provider/start", requireSession, async (c) => {
    const provider = c.req.param("provider") as Provider;
    const def = providers[provider];
    const client = cfg.oauth?.[provider];
    if (!def || !client) return c.json({ error: "not_configured", message: `${provider} OAuth is not configured` }, 501);
    const campaign = await svc.getCampaign(c.req.param("id") as string);
    const key = c.req.query("key");
    const req = campaign.requirements.find((r) => r.key === key && r.module === moduleForProvider[provider]);
    if (!req) return c.json({ error: "bad_request", message: "Requirement key does not match provider" }, 400);
    const returnUrl = resolveReturnUrl(c.req.query("return"), cfg);
    if (!returnUrl) return c.json({ error: "bad_request", message: "return URL is not an allowed origin" }, 400);
    const returnTo = returnUrl.toString();
    const state = randomId(16);
    const verifier = def.pkce ? pkceVerifier() : "";
    await cfg.storage.setTemp(`oauth:${state}`, JSON.stringify({ campaignId: campaign.id, wallet: c.get("session").wallet, key, returnTo, verifier }), 600);
    const u = new URL(def.authUrl);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("client_id", client.clientId);
    u.searchParams.set("redirect_uri", `${cfg.baseUrl}/oauth/${provider}/callback`);
    u.searchParams.set("scope", def.scope);
    u.searchParams.set("state", state);
    if (def.pkce) {
      u.searchParams.set("code_challenge", pkceChallenge(verifier));
      u.searchParams.set("code_challenge_method", "S256");
    }
    if (provider === "google") u.searchParams.set("access_type", "online");
    // The widget opens this in a popup or navigates; JSON lets the client decide.
    return c.req.query("redirect") === "1" ? c.redirect(u.toString()) : c.json({ url: u.toString() });
  });

  app.get("/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider") as Provider;
    const def = providers[provider];
    const client = cfg.oauth?.[provider];
    const state = c.req.query("state") ?? "";
    const raw = await cfg.storage.getTemp(`oauth:${state}`);
    if (!def || !client || !raw) return c.text("Invalid or expired OAuth state", 400);
    await cfg.storage.deleteTemp(`oauth:${state}`);
    const { campaignId, wallet, key, returnTo, verifier } = JSON.parse(raw) as { campaignId: string; wallet: string; key: string; returnTo: string; verifier: string };
    const back = (status: "ok" | "error", msg?: string) => {
      const u = resolveReturnUrl(returnTo, cfg) ?? new URL("/", cfg.baseUrl); // re-validated; state could not have been tampered with, but belt and braces
      u.searchParams.set("allowlist", `${key}:${status}`);
      if (msg) u.searchParams.set("allowlist_msg", msg);
      return c.redirect(u.toString());
    };
    if (c.req.query("error")) return back("error", c.req.query("error_description") ?? "Authorization denied");
    const code = c.req.query("code");
    if (!code) return back("error", "Missing code");
    const body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${cfg.baseUrl}/oauth/${provider}/callback`, client_id: client.clientId });
    if (def.pkce) body.set("code_verifier", verifier);
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
    if (def.basicAuth) headers.authorization = `Basic ${btoa(`${client.clientId}:${client.clientSecret}`)}`;
    else body.set("client_secret", client.clientSecret);
    const tokenRes = await fetch(def.tokenUrl, { method: "POST", headers, body });
    if (!tokenRes.ok) return back("error", `Token exchange failed (${tokenRes.status})`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    try {
      const profile = await def.profile(access_token);
      const campaign = await svc.getCampaign(campaignId);
      const { result } = await svc.verifyRequirement(campaign, wallet, key, profile);
      return back(result.passed ? "ok" : "error", result.passed ? undefined : result.reason);
    } catch (e) {
      return back("error", (e as Error).message);
    }
  });
}
