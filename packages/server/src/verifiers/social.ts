/**
 * Social verifiers. The OAuth dance itself lives in routes/oauth.ts; once a
 * provider profile has been obtained, it is passed here as `input` where we
 * (1) enforce one-social-account-per-wallet uniqueness and (2) check any
 * extra requirement (follow, guild, role, subscription).
 */
import { z } from "zod";
import {
  DiscordVerificationModule,
  SocialTaskModule,
  TelegramVerificationModule,
  XVerificationModule,
  YouTubeVerificationModule,
} from "@solana-allowlist/core";
import { fail, pass, type Verifier, type VerifyContext } from "./types.js";
import { hmacHex, sha256Hex } from "../crypto.js";

export interface SocialProfile {
  provider: "x" | "discord" | "google" | "telegram";
  id: string;
  handle?: string;
  accessToken?: string;
  meta?: Record<string, unknown>;
}

/** Enforce that a provider account is linked to at most one wallet per campaign. */
async function claimIdentity(ctx: VerifyContext<unknown, SocialProfile>): Promise<string | null> {
  const { storage, campaign, wallet, input } = ctx;
  const existing = await storage.getSocialLink(campaign.id, input.provider, input.id);
  if (existing && existing.wallet !== wallet) {
    return `This ${input.provider} account is already linked to another wallet.`;
  }
  await storage.putSocialLink({
    campaignId: campaign.id,
    provider: input.provider,
    providerUserId: input.id,
    wallet,
    handle: input.handle,
    meta: input.meta,
    createdAt: existing?.createdAt ?? Date.now(),
  });
  return null;
}

/* ---------------- X ---------------- */
type XCfg = z.infer<typeof XVerificationModule.configSchema>;
export const xVerifier: Verifier<XCfg, SocialProfile> = {
  moduleId: XVerificationModule.id,
  async verify(ctx) {
    const { requirement, config, input } = ctx;
    const dup = await claimIdentity(ctx);
    if (dup) return fail(requirement.key, requirement.module, dup);
    const meta = (input.meta ?? {}) as { created_at?: string; followers?: number };
    if (config.minAccountAgeDays > 0 && meta.created_at) {
      const ageDays = (Date.now() - Date.parse(meta.created_at)) / 86_400_000;
      if (ageDays < config.minAccountAgeDays)
        return fail(requirement.key, requirement.module, `X account must be at least ${config.minAccountAgeDays} days old`);
    }
    if (config.minFollowers > 0 && (meta.followers ?? 0) < config.minFollowers)
      return fail(requirement.key, requirement.module, `Need at least ${config.minFollowers} followers`);
    if (config.follow && input.accessToken) {
      // Requires X API "following" lookup (paid tiers). We attempt it and, if unavailable, fall back to a self-attested click.
      const ok = await checkXFollow(input.accessToken, input.id, config.follow).catch(() => null);
      if (ok === false) return fail(requirement.key, requirement.module, `Follow @${config.follow} on X, then retry`);
      if (ok === null) (input.meta ??= {}).followCheck = "unavailable";
    }
    return pass(requirement.key, requirement.module, { id: input.id, handle: input.handle, followCheck: input.meta?.followCheck ?? "ok" });
  },
};
async function checkXFollow(token: string, userId: string, target: string): Promise<boolean | null> {
  const t = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(target)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!t.ok) return null;
  const targetId = ((await t.json()) as { data?: { id: string } }).data?.id;
  if (!targetId) return null;
  let next: string | undefined;
  for (let i = 0; i < 5; i++) {
    const u = new URL(`https://api.x.com/2/users/${userId}/following`);
    u.searchParams.set("max_results", "1000");
    if (next) u.searchParams.set("pagination_token", next);
    const r = await fetch(u, { headers: { authorization: `Bearer ${token}` } });
    if (r.status === 403 || r.status === 402) return null;
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { id: string }[]; meta?: { next_token?: string } };
    if (j.data?.some((x) => x.id === targetId)) return true;
    next = j.meta?.next_token;
    if (!next) break;
  }
  return false;
}

/* ---------------- Discord ---------------- */
type DiscordCfg = z.infer<typeof DiscordVerificationModule.configSchema>;
export const discordVerifier: Verifier<DiscordCfg, SocialProfile> = {
  moduleId: DiscordVerificationModule.id,
  async verify(ctx) {
    const { requirement, config, input, cfg } = ctx;
    const dup = await claimIdentity(ctx);
    if (dup) return fail(requirement.key, requirement.module, dup);
    if (config.guildId) {
      const guilds = (await fetch("https://discord.com/api/v10/users/@me/guilds", {
        headers: { authorization: `Bearer ${input.accessToken}` },
      }).then((r) => (r.ok ? r.json() : []))) as { id: string }[];
      if (!guilds.some((g) => g.id === config.guildId))
        return fail(requirement.key, requirement.module, "Join the Discord server first, then retry");
      if (config.roleIds.length > 0) {
        const bot = cfg.oauth?.discord?.botToken;
        if (!bot) return fail(requirement.key, requirement.module, "Role check not configured (missing bot token)");
        const m = (await fetch(`https://discord.com/api/v10/guilds/${config.guildId}/members/${input.id}`, {
          headers: { authorization: `Bot ${bot}` },
        }).then((r) => (r.ok ? r.json() : { roles: [] }))) as { roles: string[] };
        if (!m.roles?.some((r) => config.roleIds.includes(r)))
          return fail(requirement.key, requirement.module, "You don't have the required Discord role");
      }
    }
    return pass(requirement.key, requirement.module, { id: input.id, handle: input.handle });
  },
};

/* ---------------- Telegram ---------------- */
type TgCfg = z.infer<typeof TelegramVerificationModule.configSchema>;
export interface TelegramLoginData {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}
/** Validate Telegram Login Widget payload per https://core.telegram.org/widgets/login#checking-authorization */
export function verifyTelegramLogin(botToken: string, data: TelegramLoginData, maxAgeSeconds = 600): boolean {
  const { hash, ...rest } = data;
  const dataCheck = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${(rest as Record<string, unknown>)[k]}`)
    .join("\n");
  // secret_key = SHA256(bot_token); hash = HMAC_SHA256(data_check_string, secret_key)
  const secretHex = sha256Hex(botToken);
  const secretBytes = Uint8Array.from(secretHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const computed = hmacHexBytes(secretBytes, dataCheck);
  if (computed !== hash) return false;
  return Date.now() / 1000 - data.auth_date < maxAgeSeconds;
}
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";
function hmacHexBytes(key: Uint8Array, data: string) {
  return Array.from(hmac(sha256, key, new TextEncoder().encode(data)), (b) => b.toString(16).padStart(2, "0")).join("");
}
void hmacHex; // (string-key variant used elsewhere)

export const telegramVerifier: Verifier<TgCfg, TelegramLoginData> = {
  moduleId: TelegramVerificationModule.id,
  async verify(ctx) {
    const { requirement, config, input, cfg } = ctx;
    if (!cfg.telegram) return fail(requirement.key, requirement.module, "Telegram not configured on server");
    if (!verifyTelegramLogin(cfg.telegram.botToken, input))
      return fail(requirement.key, requirement.module, "Invalid or expired Telegram login");
    const profile: SocialProfile = { provider: "telegram", id: String(input.id), handle: input.username };
    const dup = await claimIdentity({ ...ctx, input: profile });
    if (dup) return fail(requirement.key, requirement.module, dup);
    if (config.chatId) {
      const r = (await fetch(
        `https://api.telegram.org/bot${cfg.telegram.botToken}/getChatMember?chat_id=${encodeURIComponent(config.chatId)}&user_id=${input.id}`,
      ).then((r) => r.json())) as { ok: boolean; result?: { status: string } };
      const status = r.result?.status;
      if (!r.ok || !status || ["left", "kicked"].includes(status))
        return fail(requirement.key, requirement.module, "Join the Telegram channel/group first, then retry");
    }
    return pass(requirement.key, requirement.module, { id: input.id, handle: input.username });
  },
};

/* ---------------- YouTube (Google) ---------------- */
type YtCfg = z.infer<typeof YouTubeVerificationModule.configSchema>;
export const youtubeVerifier: Verifier<YtCfg, SocialProfile> = {
  moduleId: YouTubeVerificationModule.id,
  async verify(ctx) {
    const { requirement, config, input } = ctx;
    const dup = await claimIdentity(ctx);
    if (dup) return fail(requirement.key, requirement.module, dup);
    const u = new URL("https://www.googleapis.com/youtube/v3/subscriptions");
    u.searchParams.set("part", "snippet");
    u.searchParams.set("mine", "true");
    u.searchParams.set("forChannelId", config.channelId);
    const r = await fetch(u, { headers: { authorization: `Bearer ${input.accessToken}` } });
    if (!r.ok) return fail(requirement.key, requirement.module, "Could not read YouTube subscriptions (grant the youtube.readonly scope)");
    const j = (await r.json()) as { items?: unknown[] };
    return (j.items?.length ?? 0) > 0
      ? pass(requirement.key, requirement.module, { id: input.id, channelId: config.channelId })
      : fail(requirement.key, requirement.module, "Subscribe to the channel, then retry");
  },
};

/* ---------------- Generic social task ---------------- */
type TaskCfg = z.infer<typeof SocialTaskModule.configSchema>;
export interface SocialTaskInput {
  /** "open" records the click; "complete" submits. */
  action: "open" | "complete";
  proofUrl?: string;
}
export const socialTaskVerifier: Verifier<TaskCfg, SocialTaskInput> = {
  moduleId: SocialTaskModule.id,
  async verify(ctx) {
    const { requirement, config, input, storage, campaign, wallet } = ctx;
    const key = `task:${campaign.id}:${wallet}:${requirement.key}`;
    if (input.action === "open") {
      await storage.setTemp(key, String(Date.now()), 3600);
      return fail(requirement.key, requirement.module, "opened", { openedAt: Date.now() });
    }
    const opened = Number((await storage.getTemp(key)) ?? 0);
    if (!opened) return fail(requirement.key, requirement.module, "Open the link first");
    if ((Date.now() - opened) / 1000 < config.minDwellSeconds)
      return fail(requirement.key, requirement.module, "That was quick — give it a moment and try again");
    if (config.requireProofUrl && !/^https?:\/\//.test(input.proofUrl ?? ""))
      return fail(requirement.key, requirement.module, "Paste the link to your post as proof");
    const evidence = { proofUrl: input.proofUrl, pendingApproval: config.requireApproval };
    if (config.requireApproval)
      return { ...fail(requirement.key, requirement.module, "Submitted — waiting for review", evidence), evidence };
    return pass(requirement.key, requirement.module, evidence);
  },
};
