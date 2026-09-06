/** Starter campaign configs for the four campaign types. */
const base = (id: string, name: string, type: string) => ({
  id, name, type, cluster: "mainnet-beta",
  description: "",
  requirements: [{ key: "wallet", module: "wallet-signature", config: {} }],
  allocation: { mode: "flat", flat: 1 },
  merkle: { enabled: false, scheme: "candy-guard" },
  metadata: {},
});

export const templates: Record<string, () => unknown> = {
  "nft-mint": () => ({
    ...base("genesis-mint", "Genesis Mint Allowlist", "nft-mint"),
    maxEntries: 2000,
    requirements: [
      { key: "wallet", module: "wallet-signature", config: {} },
      { key: "captcha", module: "captcha", config: { provider: "turnstile", siteKey: "YOUR_SITE_KEY" } },
      { key: "x", module: "x-verify", config: { minAccountAgeDays: 30 }, points: 1 },
      { key: "discord", module: "discord-verify", config: { guildId: "YOUR_GUILD_ID" }, points: 1 },
      { key: "holder", module: "nft-ownership", required: false, points: 3, config: { collection: "COLLECTION_ADDRESS", min: 1 } },
    ],
    allocation: { mode: "tiered", tiers: [{ minPoints: 0, allocation: 1, label: "Allowlist" }, { minPoints: 5, allocation: 2, label: "Holder" }], maxPerWallet: 2 },
    merkle: { enabled: true, scheme: "candy-guard" },
  }),
  "token-launch": () => ({
    ...base("token-launch", "Token Launch Eligibility", "token-launch"),
    requirements: [
      { key: "wallet", module: "wallet-signature", config: {} },
      { key: "captcha", module: "captcha", config: { provider: "turnstile", siteKey: "YOUR_SITE_KEY" } },
      { key: "quiz", module: "quiz", config: { passScore: 1, maxAttempts: 3, questions: [{ id: "q1", prompt: "What is the max supply?", type: "single", options: ["1M", "100M", "1B"], answer: 2 }] } },
      { key: "x", module: "x-verify", config: {}, points: 1 },
      { key: "tg", module: "telegram-verify", config: { chatId: "@yourchannel" }, points: 1 },
    ],
  }),
  presale: () => ({
    ...base("presale", "Presale Whitelist", "presale"),
    requirements: [
      { key: "wallet", module: "wallet-signature", config: {} },
      { key: "hold", module: "token-balance", config: { mint: "TOKEN_MINT", min: 1000 } },
      { key: "referral", module: "referral", required: false, config: { referrerPoints: 2, maxReferrals: 50 } },
    ],
    allocation: { mode: "tiered", tiers: [{ minPoints: 0, allocation: 100 }, { minPoints: 4, allocation: 250 }, { minPoints: 10, allocation: 500 }], totalSupply: 100000 },
  }),
  community: () => ({
    ...base("community", "Community Campaign", "community"),
    requirements: [
      { key: "wallet", module: "wallet-signature", config: {} },
      { key: "yt", module: "social-task", required: false, points: 1, config: { url: "https://youtube.com/@yourchannel", label: "Subscribe on YouTube", minDwellSeconds: 5 } },
      { key: "rt", module: "social-task", required: false, points: 2, config: { url: "https://x.com/yourproject/status/123", label: "Repost the announcement", requireProofUrl: true, requireApproval: true } },
      { key: "quiz", module: "quiz", required: false, points: 2, config: { passScore: 0, questions: [{ id: "why", prompt: "Why do you want in?", type: "text" }] } },
    ],
    minPoints: 2,
  }),
};
