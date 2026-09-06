# Grant rationale

## Problem: allowlists are the last piece of Solana launch infrastructure still locked in SaaS

Wallets, RPC, mint programs (Candy Machine, Core), token programs, DEX listing — every layer of a Solana launch has a strong open-source default. Allowlisting does not. Projects today choose between:

1. **Hosted launchpads / quest platforms** — fast to set up, but the project's community registers on someone else's domain, the registration data is held by the vendor, requirement types are fixed, and mint integration only works with the vendor's tooling. Pricing and availability are outside the project's control, and a vendor incident on mint day is the project's incident.
2. **Hand-rolled Google Forms + scripts** — free, but no signature verification, no duplicate prevention, no social checks, no bot resistance, and a manual Merkle step that gets botched under time pressure.

Both paths leak value out of the ecosystem: (1) to closed platforms, (2) to bots and sybil farms.

## What this project delivers

A single MIT-licensed framework that makes the self-hosted path the *easiest* path:

- **Embeddable**: one React component or one `<script>` tag; the widget inherits the project's own design.
- **Self-hosted anywhere**: the API is a `fetch` handler — Node, Vercel, Cloudflare Workers, Deno. Storage is a 20-method interface with SQLite in-tree.
- **Modular**: wallet signature, SPL/Token-2022 balance, NFT ownership (Metadata/Core/cNFT via DAS), X, Discord, Telegram, YouTube, generic social tasks, quiz, referrals, CAPTCHA — and a documented interface for adding more in ~30 lines.
- **Honest verification**: every check states what is cryptographically or API-verified versus self-attested; exports carry that distinction.
- **Mint-ready output**: CSV/JSON, wallet lists, Candy-Guard-compatible Merkle roots and per-wallet proofs, a public eligibility endpoint, and signed webhooks.
- **Operable**: an admin dashboard for campaign config, entry review/approval, pre-mint snapshot re-checks, exports, webhooks and API keys.

## Why it's a public good

- Every project that adopts it removes a dependency on a closed intermediary and keeps its community relationship (and data) on its own domain.
- Shared anti-sybil primitives (social-identity uniqueness, CAPTCHA, rate limits, re-verifiable holdings) raise the floor for every launch instead of each team reinventing them.
- A common campaign JSON schema makes allowlist logic portable and auditable; a community can read exactly what was required.
- Custom modules let ecosystem teams (staking protocols, DAOs, identity providers) plug in once and be usable by every project.

## Milestones

| Phase | Deliverable |
|---|---|
| 1 (this repo) | Core engine, server with all listed modules, React widget, script embed, admin dashboard, docs, tests |
| 2 | Postgres + D1 adapters, wallet-standard `signIn`, allocation curves by holdings, visual requirement builder |
| 3 | Optional on-chain eligibility registry (PDA per wallet) for trustless mints; audit; reference deployments with 3+ launch partners |

## Success metrics

- Number of live campaigns on self-hosted deployments
- Wallets registered without a hosted intermediary
- Third-party modules published against the module API
- Launch-day incidents attributable to allowlist infra (target: zero)
