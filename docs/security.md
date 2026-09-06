# Security model

- **Wallet ownership**: SIWS-style message with a server-issued nonce (5 min TTL, single use), ed25519-verified. Sessions are HMAC-signed, 24h by default, bound to one campaign.
- **Duplicate prevention**: wallet is the primary key; social identities are unique per campaign (a Discord/X/Telegram/Google account can back only one wallet). Referral self-use is blocked; referrer credits are capped.
- **Anti-bot**: CAPTCHA module (Turnstile/hCaptcha/reCAPTCHA v3), per-IP rate limiting, X account-age/follower thresholds, minimum dwell time on social tasks, quiz attempt limits.
- **Secrets**: quiz answers never leave the server (`publicConfig` strips them). OAuth client secrets, bot tokens, captcha secrets live in server env only. Webhook secrets and API keys are shown once and stored hashed (API keys) / at rest (webhook secrets, needed for signing).
- **On-chain re-verification**: balances and holdings can be re-checked at any time (`/recheck`) so the final export reflects a snapshot, not registration-time state.
- **Merkle**: proofs are derived from the eligible set at request time; publish the root on-chain only after a final snapshot.
- **Follow checks on X**: X's `following` lookup requires a paid API tier. If unavailable the module links the account and records `followCheck: "unavailable"`; use `social-task` with `requireApproval` as a fallback.
