import { z } from "zod";
import { CaptchaModule, QuizModule, ReferralModule } from "@solana-allowlist/core";
import { fail, pass, type Verifier } from "./types.js";

/* ---------------- Quiz ---------------- */
type QuizCfg = z.infer<typeof QuizModule.configSchema>;
export interface QuizInput {
  answers: Record<string, number | number[] | string>;
}
export const quizVerifier: Verifier<QuizCfg, QuizInput> = {
  moduleId: QuizModule.id,
  publicConfig(config) {
    return { ...config, questions: config.questions.map(({ answer: _a, ...q }) => q) };
  },
  async verify({ requirement, config, input, storage, campaign, wallet }) {
    const attemptsKey = `quiz:${campaign.id}:${wallet}:${requirement.key}`;
    const attempts = await storage.incrTemp(attemptsKey, 86_400);
    if (attempts > config.maxAttempts) return fail(requirement.key, requirement.module, "No attempts left today");

    let scored = 0;
    let correct = 0;
    for (const q of config.questions) {
      const a = input.answers?.[q.id];
      if (q.required && (a === undefined || a === "" || (Array.isArray(a) && a.length === 0)))
        return fail(requirement.key, requirement.module, `Answer "${q.prompt}"`);
      if (q.answer === undefined) continue;
      scored++;
      if (q.type === "single" && a === q.answer) correct++;
      else if (q.type === "multi" && Array.isArray(a) && Array.isArray(q.answer)) {
        const s = new Set(a);
        if (s.size === q.answer.length && q.answer.every((x) => s.has(x))) correct++;
      } else if (q.type === "text" && typeof a === "string" && typeof q.answer === "string") {
        const re = q.answer.startsWith("/") && q.answer.endsWith("/") ? new RegExp(q.answer.slice(1, -1), "i") : null;
        if (re ? re.test(a.trim()) : a.trim().toLowerCase() === q.answer.trim().toLowerCase()) correct++;
      }
    }
    const score = scored === 0 ? 1 : correct / scored;
    const evidence = { score, correct, scored, attempt: attempts, answers: input.answers };
    return score >= config.passScore
      ? pass(requirement.key, requirement.module, evidence)
      : fail(requirement.key, requirement.module, `Scored ${correct}/${scored}; need ${Math.ceil(config.passScore * scored)}`, evidence);
  },
};

/* ---------------- Referral ---------------- */
type RefCfg = z.infer<typeof ReferralModule.configSchema>;
export interface ReferralInput {
  code?: string;
}
export const referralVerifier: Verifier<RefCfg, ReferralInput> = {
  moduleId: ReferralModule.id,
  async verify({ requirement, config, input, storage, campaign, entry }) {
    const code = input.code?.trim().toUpperCase();
    if (!code) {
      return config.requireCode
        ? fail(requirement.key, requirement.module, "Enter a referral code")
        : pass(requirement.key, requirement.module, { code: null });
    }
    if (entry.referredBy) return pass(requirement.key, requirement.module, { code, referredBy: entry.referredBy });
    if (code === entry.referralCode) return fail(requirement.key, requirement.module, "You can't refer yourself");
    const referrer = await storage.findEntryByReferralCode(campaign.id, code);
    if (!referrer) return fail(requirement.key, requirement.module, "Unknown referral code");
    const countKey = `refcount:${campaign.id}:${referrer.wallet}`;
    const n = await storage.incrTemp(countKey, 60 * 60 * 24 * 365);
    if (n <= config.maxReferrals && config.referrerPoints > 0) {
      // Credit the referrer via a synthetic result so it shows up in points/export.
      const k = `${requirement.key}:credits`;
      const prev = (referrer.results[k]?.evidence?.credits as number) ?? 0;
      referrer.results[k] = {
        key: k,
        module: "referral-credit",
        passed: true,
        evidence: { credits: prev + 1, points: (prev + 1) * config.referrerPoints },
        checkedAt: Date.now(),
      };
      referrer.points += config.referrerPoints;
      referrer.updatedAt = Date.now();
      await storage.putEntry(referrer);
    }
    entry.referredBy = referrer.wallet;
    return pass(requirement.key, requirement.module, { code, referredBy: referrer.wallet });
  },
};

/* ---------------- CAPTCHA ---------------- */
type CaptchaCfg = z.infer<typeof CaptchaModule.configSchema>;
export interface CaptchaInput {
  token: string;
}
const endpoints = {
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
  hcaptcha: "https://api.hcaptcha.com/siteverify",
  recaptcha: "https://www.google.com/recaptcha/api/siteverify",
} as const;
export const captchaVerifier: Verifier<CaptchaCfg, CaptchaInput> = {
  moduleId: CaptchaModule.id,
  publicConfig(config) {
    return { provider: config.provider, siteKey: config.siteKey };
  },
  async verify({ requirement, config, input, cfg, ip }) {
    const secret =
      config.provider === "turnstile"
        ? cfg.captcha?.turnstileSecret
        : config.provider === "hcaptcha"
          ? cfg.captcha?.hcaptchaSecret
          : cfg.captcha?.recaptchaSecret;
    if (!secret) return fail(requirement.key, requirement.module, `${config.provider} secret not configured on server`);
    if (!input?.token) return fail(requirement.key, requirement.module, "Complete the CAPTCHA");
    const body = new URLSearchParams({ secret, response: input.token });
    if (ip) body.set("remoteip", ip);
    const r = (await fetch(endpoints[config.provider], { method: "POST", body }).then((r) => r.json())) as {
      success: boolean;
      score?: number;
      "error-codes"?: string[];
    };
    if (!r.success) return fail(requirement.key, requirement.module, "CAPTCHA failed", { errors: r["error-codes"] });
    if (config.provider === "recaptcha" && (r.score ?? 0) < config.minScore)
      return fail(requirement.key, requirement.module, "CAPTCHA score too low", { score: r.score });
    return pass(requirement.key, requirement.module, { provider: config.provider, score: r.score });
  },
};
