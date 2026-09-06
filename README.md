# Solana Allowlist

An open-source, modular allowlist and eligibility framework for Solana projects.
Embed it in **your own website**; run it on **your own server**; export **your own data**.
No launchpad. No hosted platform. No lock-in.

```
Solana Allowlist SDK
        │
        ├── Wallet Signature          (SIWS-style nonce + ed25519)
        ├── Token Holding Check       (SPL + Token-2022 via RPC)
        ├── NFT Ownership Check       (collection / creator / mint via DAS — Metadata, Core, cNFT)
        ├── X Verification            (OAuth 2.0 PKCE, account age, followers, follow*)
        ├── Telegram Verification     (Login Widget + channel membership)
        ├── Discord Verification      (OAuth 2.0, guild + role)
        ├── YouTube Subscription      (Google OAuth, youtube.readonly)
        ├── Social task               (click-through + proof + optional review)
        ├── Custom Quiz               (scored or collection-only)
        ├── Referral codes            (per-wallet codes, referrer points, caps)
        ├── Anti-Bot                  (Turnstile / hCaptcha / reCAPTCHA, rate limits, dwell time)
        └── Custom Module API         (define + verify your own requirement in ~30 lines)

Project Website ──▶ <AllowlistWidget/> or <script> embed ──▶ users complete requirements
        ──▶ verified, de-duplicated wallet with points + allocation
        ──▶ CSV / JSON / wallet list / Merkle root+proofs / eligibility API / webhooks
```

Works for NFT mints, token launches, presales and community campaigns — the same engine, different requirement sets and allocation rules.

## Why: eliminate launchpad lock-in

Today most Solana projects run allowlists on hosted launchpads or "quest" platforms. That trade looks free but isn't:

| With a hosted launchpad | With this framework |
|---|---|
| Your community registers on *their* domain, under *their* brand | Users never leave your site; the widget inherits your fonts and colours |
| Wallet + social data lives in their database; exports are partial or paywalled | You own the database (a SQLite file or your Postgres) and every export format |
| Requirement types are whatever they ship | Requirements are modules; add your own in one file |
| Mint integration is their SDK or nothing | Merkle roots compatible with Metaplex Candy Guard, plus a plain HTTP eligibility endpoint any mint contract/frontend can call |
| Pricing, terms and availability change under you | MIT-licensed code you run on a $5 VPS, Vercel, Cloudflare Workers or Deno |
| Vendor outage on mint day = your outage | Your infra, your uptime |

The goal of this project is to make the self-hosted path *easier* than the hosted one: one `npx` to start the API, one component (or one `<script>` tag) to embed, one admin page to run the campaign.

## Packages

| Package | What it is |
|---|---|
| `@solana-allowlist/core` | Types, module registry, eligibility engine, tiered allocation, Merkle tree (Candy Guard compatible), CSV/JSON export. Zero I/O; runs anywhere. |
| `@solana-allowlist/server` | Hono API: wallet auth, all built-in verifiers, OAuth flows, webhooks, admin endpoints. Storage adapters (memory, SQLite; Postgres/D1 are a copy-paste away). |
| `@solana-allowlist/react` | `<AllowlistWidget/>` plus headless `useAllowlist()` hook and `AllowlistClient`. Works with Wallet Standard out of the box or with your existing wallet-adapter. |
| `@solana-allowlist/embed` | One `<script>` tag for Webflow / Framer / WordPress / static HTML. |
| `@solana-allowlist/admin` | Self-hosted dashboard: campaigns, entries, approvals, snapshot re-checks, exports, webhooks, API keys. |

## Quick start

```bash
pnpm install && pnpm build

# 1. API
cd packages/server
cp .env.example .env            # set SESSION_SECRET, ADMIN_API_KEY, SOLANA_RPC_URL (+ OAuth creds you need)
pnpm dev                        # http://localhost:8787

# 2. Admin
cd ../admin && pnpm dev         # http://localhost:5173 → connect with your ADMIN_API_KEY, pick a template, save

# 3. Embed on your site
```

```tsx
import { AllowlistWidget } from "@solana-allowlist/react";
import "@solana-allowlist/react/styles.css";

<AllowlistWidget baseUrl="https://api.myproject.xyz" campaignId="genesis-mint" theme="dark" />
```

or, without React:

```html
<div data-allowlist data-base-url="https://api.myproject.xyz" data-campaign="genesis-mint"></div>
<script src="https://unpkg.com/@solana-allowlist/embed/dist/embed.global.js" defer></script>
```

## A campaign is JSON

```jsonc
{
  "id": "genesis-mint",
  "name": "Genesis Mint",
  "type": "nft-mint",
  "endsAt": "2026-10-01T00:00:00Z",
  "maxEntries": 2000,
  "requirements": [
    { "key": "wallet",  "module": "wallet-signature", "config": {} },
    { "key": "captcha", "module": "captcha", "config": { "provider": "turnstile", "siteKey": "…" } },
    { "key": "discord", "module": "discord-verify", "config": { "guildId": "123", "roleIds": ["456"] } },
    { "key": "x",       "module": "x-verify", "config": { "minAccountAgeDays": 30 }, "points": 1 },
    { "key": "holder",  "module": "nft-ownership", "required": false, "points": 3,
      "config": { "collection": "…", "min": 1 } },
    { "key": "quiz",    "module": "quiz", "required": false, "points": 1,
      "config": { "passScore": 1, "questions": [{ "id": "q1", "prompt": "Mint price?", "options": ["0.5", "1"], "answer": 1 }] } }
  ],
  "allocation": {
    "mode": "tiered",
    "tiers": [{ "minPoints": 0, "allocation": 1 }, { "minPoints": 4, "allocation": 2 }],
    "maxPerWallet": 2,
    "totalSupply": 3000
  },
  "merkle": { "enabled": true, "scheme": "candy-guard" }
}
```

Eligibility = every `required` requirement passed **and** `points ≥ minPoints`. Allocation is flat, tiered by points, or per-requirement, then capped per wallet and by total supply (first-come by eligibility time). Caps are applied at export time so the ranked list is always consistent.

## Getting the list out

- **Admin → Export**: CSV, JSON (with evidence), plain wallet list, Merkle root + proofs.
- **Mint-time API**: `GET /campaigns/:id/eligibility/:wallet` → `{ eligible, allocation, merkle: { root, proof } }`.
- **Webhooks**: HMAC-signed events (`entry.eligible`, …) to your backend, Discord bot, CRM.
- **Candy Machine**: see `examples/candy-machine` — the tree hashes exactly like `mpl-candy-machine`'s `getMerkleRoot`.

## Extending

Add a module (definition + verifier) — [docs/custom-modules.md](docs/custom-modules.md).
Swap storage — [docs/storage.md](docs/storage.md). API reference — [docs/api.md](docs/api.md). Threat model — [docs/security.md](docs/security.md). Grant rationale — [docs/grant-rationale.md](docs/grant-rationale.md).

## What's verified vs. attested

| Check | How |
|---|---|
| Wallet ownership | cryptographically |
| Token / NFT holdings | on-chain read, re-checkable any time |
| Discord guild + role | provider API |
| Telegram channel membership | bot API |
| YouTube subscription | provider API (user grants `youtube.readonly`) |
| X account link, age, followers | provider API |
| X follow | provider API **if** your X API tier allows; otherwise recorded as unavailable |
| Likes / reposts / comments | not exposed by platforms → `social-task` (click-through + proof + optional manual approval) |

We'd rather be honest about the last two rows than pretend, which is also why "verified" columns in the export say exactly what was checked.

## Roadmap

- Postgres / D1 adapters in-tree
- Allocation by holdings quantity (linear / sqrt curves)
- Sign-In-With-Solana (wallet-standard `solana:signIn`) as an alternative to signMessage
- Optional on-chain registration (record eligibility as a PDA for fully trustless mints)
- Admin: visual requirement builder, entry timeline, audit log
- i18n for the widget

## License

MIT.
